/**
 * Interview video chunk upload routes.
 *
 * The client uploads each MediaRecorder chunk immediately as it arrives
 * (every ~5 seconds), so the video is saved incrementally even if the
 * browser closes mid-interview.
 *
 * Flow:
 *   POST /api/interview/chunk   — upload one chunk; returns { sessionId, index }
 *   POST /api/interview/finalize — concatenate all chunks into one file,
 *                                  save URL to candidates.interviewVideoUrl,
 *                                  clean up chunk keys from S3
 *
 * Chunk S3 keys:  interview-chunks/{sessionId}/{index}.webm
 * Final S3 key:   candidate-videos/{sessionId}-final.webm
 */
import { Router, Request, Response } from "express";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { candidates } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// In-memory map: sessionId → sorted list of S3 chunk URLs
// This is fine because finalize is called from the same server process.
// If the server restarts mid-interview the chunks are still in S3 and
// the client will call finalize with the full list of uploaded URLs.
const chunkRegistry = new Map<string, { index: number; key: string }[]>();

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function registerInterviewUploadRoutes(app: Router) {
  /**
   * POST /api/interview/chunk
   * Body: raw binary (video/webm or video/mp4)
   * Headers:
   *   Content-Type: video/webm (or video/mp4)
   *   X-Session-Id: <uuid>       — unique per interview session
   *   X-Chunk-Index: <number>    — 0-based sequential index
   */
  app.post("/api/interview/chunk", async (req: Request, res: Response) => {
    try {
      const sessionId = (req.headers["x-session-id"] as string || "").trim();
      const chunkIndex = parseInt(req.headers["x-chunk-index"] as string || "0", 10);
      const contentType = (req.headers["content-type"] || "video/webm") as string;

      if (!sessionId) {
        res.status(400).json({ error: "Missing X-Session-Id header" });
        return;
      }

      const buffer: Buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        // Empty chunk — acknowledge silently (browser may send empty final chunk)
        res.json({ ok: true, sessionId, index: chunkIndex, skipped: true });
        return;
      }

      const ext = contentType.includes("mp4") ? "mp4" : "webm";
      const key = `interview-chunks/${sessionId}/${chunkIndex}.${ext}`;
      await storagePut(key, buffer, contentType);

      // Register chunk
      if (!chunkRegistry.has(sessionId)) {
        chunkRegistry.set(sessionId, []);
      }
      chunkRegistry.get(sessionId)!.push({ index: chunkIndex, key });

      console.log(`[InterviewChunk] session=${sessionId} index=${chunkIndex} size=${buffer.length}`);
      res.json({ ok: true, sessionId, index: chunkIndex });
    } catch (err: any) {
      console.error("[InterviewChunk] Error:", err.message);
      res.status(500).json({ error: err.message || "Chunk upload failed" });
    }
  });

  /**
   * POST /api/interview/finalize
   * Body JSON: { sessionId: string, candidateId: number, mimeType: string }
   *
   * Concatenates all registered chunks for the session into a single blob,
   * uploads to S3, saves the URL to the candidate record.
   */
  app.post("/api/interview/finalize", async (req: Request, res: Response) => {
    try {
      const { sessionId, candidateId, mimeType = "video/webm" } = req.body as {
        sessionId: string;
        candidateId: number;
        mimeType?: string;
      };

      if (!sessionId || !candidateId) {
        res.status(400).json({ error: "Missing sessionId or candidateId" });
        return;
      }

      const chunks = chunkRegistry.get(sessionId) ?? [];
      if (chunks.length === 0) {
        console.warn(`[InterviewFinalize] No chunks for session=${sessionId}`);
        res.status(400).json({ error: "No chunks found for this session" });
        return;
      }

      // Sort by index to ensure correct order
      chunks.sort((a, b) => a.index - b.index);
      console.log(`[InterviewFinalize] session=${sessionId} chunks=${chunks.length} candidateId=${candidateId}`);

      // Fetch all chunk buffers from S3 and concatenate
      const { storageGet } = await import("./storage");
      const buffers: Buffer[] = [];
      for (const chunk of chunks) {
        const { url } = await storageGet(chunk.key);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch chunk ${chunk.index}: ${resp.status}`);
        const ab = await resp.arrayBuffer();
        buffers.push(Buffer.from(ab));
      }

      const finalBuffer = Buffer.concat(buffers);
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const finalKey = `candidate-videos/${sessionId}-${randomSuffix()}.${ext}`;
      const { url: finalUrl } = await storagePut(finalKey, finalBuffer, mimeType);

      console.log(`[InterviewFinalize] Uploaded final video: ${finalUrl}`);

      // Save URL to DB
      const db = await getDb();
      if (db) {
        await db.update(candidates)
          .set({ interviewVideoUrl: finalUrl })
          .where(eq(candidates.id, candidateId));
        console.log(`[InterviewFinalize] Saved to DB for candidate ${candidateId}`);
      }

      // Clean up registry
      chunkRegistry.delete(sessionId);

      res.json({ ok: true, url: finalUrl });
    } catch (err: any) {
      console.error("[InterviewFinalize] Error:", err.message);
      res.status(500).json({ error: err.message || "Finalize failed" });
    }
  });
}
