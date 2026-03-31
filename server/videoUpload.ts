/**
 * Video upload route for applicant interview recordings.
 * POST /api/upload/video — accepts a raw binary body (video/webm or video/mp4)
 * and returns { url } pointing to the S3 CDN URL.
 */
import { Router, Request, Response } from "express";
import { storagePut } from "./storage";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function registerVideoUploadRoute(app: Router) {
  app.post("/api/upload/video", async (req: Request, res: Response) => {
    try {
      const contentType = (req.headers["content-type"] || "video/webm") as string;
      let ext = "webm";
      if (contentType.includes("mp4")) ext = "mp4";
      else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = "jpg";
      else if (contentType.includes("png")) ext = "png";
      else if (contentType.includes("gif")) ext = "gif";
      else if (contentType.includes("webp")) ext = "webp";
      const folder = contentType.startsWith("image/") ? "candidate-photos" : "candidate-videos";
      const key = `${folder}/${Date.now()}-${randomSuffix()}.${ext}`;

      // req.body is a Buffer when express.raw() middleware is active
      const buffer: Buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        res.status(400).json({ error: "Empty or invalid video body" });
        return;
      }

      const { url } = await storagePut(key, buffer, contentType);
      res.json({ url });
    } catch (err: any) {
      console.error("[VideoUpload] Error:", err.message);
      res.status(500).json({ error: err.message || "Upload failed" });
    }
  });
}
