// Storage helpers using Cloudflare R2 (S3-compatible)
// Credentials: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getS3Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials missing: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  return process.env.R2_BUCKET ?? "leadflow-files";
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * Generate a 200px-wide JPEG thumbnail from an image buffer using Sharp.
 * Returns the thumbnail buffer and the suggested content type.
 * Falls back gracefully — if Sharp fails for any reason, returns null.
 */
export async function generateThumbnail(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const supportedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (!supportedTypes.includes(mimeType.toLowerCase())) return null;
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default ?? sharpModule;
    const thumbBuffer = await sharp(buffer)
      .resize({ width: 200, withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
    return { buffer: thumbBuffer, contentType: "image/jpeg" };
  } catch (err) {
    console.warn("[Storage] Thumbnail generation failed:", err);
    return null;
  }
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as any);

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  // Use R2_PUBLIC_URL (public dev URL or custom domain) for the returned URL.
  // Falls back to the S3 API endpoint if not set (files won't be publicly accessible).
  const publicBase = (process.env.R2_PUBLIC_URL ?? process.env.R2_ENDPOINT ?? "").replace(/\/+$/, "");
  const url = `${publicBase}/${key}`;

  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(client, command, { expiresIn: 3600 });

  return { key, url };
}
