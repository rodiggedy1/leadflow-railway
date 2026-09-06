import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const router = fs.readFileSync(path.join(root, "server/leadflowJobsRouter.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "client/src/components/NativeBookingsWorkspace.tsx"), "utf8");
const stylesheet = fs.readFileSync(path.join(root, "client/src/pages/bookings-preview.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server/_core/index.ts"), "utf8");

describe("Booking detail isolated cleaner photo gallery", () => {
  it("allows staff to read the existing isolated photo metadata through a namespaced Booking reference", () => {
    expect(router).toContain("staffPhotos: adminAgentProcedure");
    expect(router).toContain("cleanerPortalJobPhotos");
    expect(router).toContain("bookingPhotoReferenceInput");
    expect(router).toContain("parseBookingPhotoReference(input.bookingKey)");
    expect(router).toContain("eq(cleanerPortalJobPhotos.leadflowJobId, sourceId)");
    expect(router).not.toContain("cleanerJobs");
    expect(router).not.toContain("cleaner_jobs");
  });

  it("renders staff-only Before and After groups in every existing Booking detail", () => {
    expect(workspace).toContain("trpc.leadflowJobs.staffPhotos.useQuery");
    expect(workspace).toContain('const activePhotoBookingKey = active ? `${active.source}:${active.id}` : "leadflow:0"');
    expect(workspace).not.toContain("active.source === \"leadflow\" && <section className=\"bookings-editor-section\"><div className=\"bookings-photo-review-title\"");
    expect(workspace).toContain('label: "Before", detail: "Visit condition"');
    expect(workspace).toContain('label: "After", detail: "Finished result"');
    expect(workspace).toContain("bookings-photo-review-groups");
  });

  it("reuses the established full-size photo review pattern and offers original download", () => {
    expect(workspace).toContain("bookings-photo-lightbox");
    expect(workspace).toContain("photoDownloadUrl(activePhoto, photoLightbox.index)");
    expect(workspace).toContain("Download original");
    expect(workspace).toContain("/api/media-proxy?url=");
    expect(server).toContain('const download = req.query.download === "1"');
    expect(server).toContain("res.attachment(safeFilename)");
    expect(workspace).toContain("ArrowLeft");
    expect(workspace).toContain("ArrowRight");
    expect(stylesheet).toContain(".bookings-photo-review-grid");
    expect(stylesheet).toContain(".bookings-photo-lightbox");
  });
});
