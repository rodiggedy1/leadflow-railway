import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const photoRouter = fs.readFileSync(path.join(root, "server/cleanerPortalPhotoRouter.ts"), "utf8");
const portal = fs.readFileSync(path.join(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8");
const listRouter = fs.readFileSync(path.join(root, "server/cleanerPortalReadOnlyRouter.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "server/versioned-migrations/0028_create_cleaner_portal_job_photos.sql"), "utf8");
const postconditions = fs.readFileSync(path.join(root, "server/versioned-migrations/0028_create_cleaner_portal_job_photos.postconditions.json"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "server/versioned-migrations/manifest.json"), "utf8")) as { migrations: Array<{ id: string; mode?: string; sqlFile: string; postconditionsFile: string; sha256: string }> };

describe("isolated Cleaner Portal photo workflow", () => {
  it("preserves the established photo-library picker and multi-file upload behavior", () => {
    expect(portal).toContain('type="file" accept="image/*" multiple');
    expect(portal).not.toMatch(/\bcapture\b/);
    expect(portal).toContain("FileReader");
    expect(portal).toContain("photoType: index === 0 ? pendingPhotoType : \"after\"");
  });

  it("reuses the established conversion, original upload, and thumbnail workflow", () => {
    expect(photoRouter).toContain('import heicConvert from "heic-convert"');
    expect(photoRouter).toContain("await heicConvert");
    expect(photoRouter).toContain("storagePut(fileKey, buffer, mimeType)");
    expect(photoRouter).toContain("generateThumbnail(buffer, mimeType)");
    expect(photoRouter).toContain("-thumb.jpg");
  });

  it("uses exact LeadFlow team ownership and contains no legacy photo or job path", () => {
    expect(photoRouter).toContain('regex(/^leadflow:\\d+$/');
    expect(photoRouter).toContain("eq(leadflowJobs.teamId, cleaner.teamId)");
    expect(photoRouter).toContain("cleanerPortalJobPhotos");
    for (const forbidden of ["cleanerJobs", "cleaner_jobs", "jobPhotos", "cleaner.uploadPhoto", "completedJobId"]) {
      expect(photoRouter).not.toContain(forbidden);
    }
  });

  it("keeps the working job-list source independent of photo metadata", () => {
    expect(listRouter).not.toContain("cleanerPortalJobPhotos");
    expect(listRouter).not.toContain("cleanerPortalPhoto");
  });

  it("registers a non-destructive managed photo migration with verified metadata", () => {
    const entry = manifest.migrations.find(item => item.id === "0028_create_cleaner_portal_job_photos");
    expect(entry).toMatchObject({ mode: "create-table", sqlFile: "0028_create_cleaner_portal_job_photos.sql", postconditionsFile: "0028_create_cleaner_portal_job_photos.postconditions.json" });
    expect(entry?.sha256).toBe(createHash("sha256").update(migration).digest("hex"));
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `cleaner_portal_job_photos`");
    expect(migration).not.toMatch(/^\s*(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/im);
    expect(postconditions).toContain('"table": "cleaner_portal_job_photos"');
  });
});
