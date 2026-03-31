/**
 * Interview video chunk upload routes.
 *
 * Each MediaRecorder chunk is uploaded immediately and its S3 key is persisted
 * to the `interview_chunks` DB table — so finalize works even after a server
 * restart between chunk uploads and the call ending.
 *
 * Flow:
 *   POST /api/interview/chunk   — upload one chunk to S3, save key to DB
 *   POST /api/interview/finalize — read keys from DB, concatenate, save final URL
 *
 * Chunk S3 keys:  interview-chunks/{sessionId}/{index}.webm
 * Final S3 key:   candidate-videos/{sessionId}-final.webm
 */
import { Router, Request, Response } from "express";
import { storagePut, storageGet } from "./storage";
import { getDb } from "./db";
import { candidates, interviewChunks } from "../drizzle/schema";
import { eq, asc } from "drizzle-orm";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function registerInterviewUploadRoutes(app: Router) {
  /**
   * POST /api/interview/chunk
   * Body: raw binary (video/webm or video/mp4)
   * Headers:
   *   Content-Type: video/webm
   *   X-Session-Id: <uuid>
   *   X-Chunk-Index: <number>
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
        res.json({ ok: true, sessionId, index: chunkIndex, skipped: true });
        return;
      }

      const ext = contentType.includes("mp4") ? "mp4" : "webm";
      const key = `interview-chunks/${sessionId}/${chunkIndex}.${ext}`;
      await storagePut(key, buffer, contentType);

      // Persist chunk key to DB so finalize survives server restarts
      const db = await getDb();
      if (db) {
        await db.insert(interviewChunks).values({
          sessionId,
          chunkIndex,
          s3Key: key,
        });
      }

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

      const db = await getDb();
      if (!db) {
        res.status(500).json({ error: "Database unavailable" });
        return;
      }

      // Read chunk keys from DB — survives server restarts
      const rows = await db
        .select()
        .from(interviewChunks)
        .where(eq(interviewChunks.sessionId, sessionId))
        .orderBy(asc(interviewChunks.chunkIndex));

      if (rows.length === 0) {
        console.warn(`[InterviewFinalize] No chunks in DB for session=${sessionId}`);
        res.status(400).json({ error: "No chunks found for this session" });
        return;
      }

      console.log(`[InterviewFinalize] session=${sessionId} chunks=${rows.length} candidateId=${candidateId}`);

      // Fetch all chunk buffers from S3 and concatenate
      const buffers: Buffer[] = [];
      for (const row of rows) {
        const { url } = await storageGet(row.s3Key);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch chunk ${row.chunkIndex}: ${resp.status}`);
        const ab = await resp.arrayBuffer();
        buffers.push(Buffer.from(ab));
      }

      const finalBuffer = Buffer.concat(buffers);
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const finalKey = `candidate-videos/${sessionId}-${randomSuffix()}.${ext}`;
      const { url: finalUrl } = await storagePut(finalKey, finalBuffer, mimeType);

      console.log(`[InterviewFinalize] Uploaded final video: ${finalUrl}`);

      // Save URL to candidate record
      await db.update(candidates)
        .set({ interviewVideoUrl: finalUrl })
        .where(eq(candidates.id, candidateId));
      console.log(`[InterviewFinalize] Saved to DB for candidate ${candidateId}`);

      // Clean up chunk rows from DB
      await db.delete(interviewChunks).where(eq(interviewChunks.sessionId, sessionId));

      res.json({ ok: true, url: finalUrl });
    } catch (err: any) {
      console.error("[InterviewFinalize] Error:", err.message);
      res.status(500).json({ error: err.message || "Finalize failed" });
    }
  });
}
