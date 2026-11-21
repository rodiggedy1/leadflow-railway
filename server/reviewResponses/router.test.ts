import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewResponseService } from "../../shared/reviewResponses";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn() }));
vi.mock("../_core/agentAuth", () => ({ getAgentFromRequest: mocks.auth }));
vi.mock("../_core/cleanerAuth", () => ({ getCleanerFromRequest: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
import { createReviewResponsesRouter } from "./router";
const key = "a".repeat(64);
const review = { platform: "google" as const, accountId: "a", businessId: "b", reviewId: "r", rating: 5, text: "Good work", reviewerName: "", createdAt: "2026-11-20T12:00:00Z", updatedAt: null, existingResponse: null, negotiationId: null, source: "manual" as const };
function setup() {
  const service = { list: vi.fn(async () => []), ingest: vi.fn(async () => ({})), generate: vi.fn(async () => ({})), edit: vi.fn(async () => ({})),
    approve: vi.fn(async () => ({})), acknowledge: vi.fn(async () => ({})), publish: vi.fn() };
  const getService = vi.fn(async () => service as unknown as ReviewResponseService);
  const caller = createReviewResponsesRouter(getService).createCaller({ req: {} as any, res: {} as any, user: null });
  return { caller, service, getService };
}
beforeEach(() => { vi.clearAllMocks(); mocks.db.mockImplementation(() => { throw Error("Database access forbidden"); }); });
describe("review response router — real admin middleware, fake service", () => {
  it("imports captured reviews with the authenticated admin actor and never generates", async () => {
    const { service, getService } = setup();
    const captured = { ...review, platform: "thumbtack" as const, accountId: "captured-webhook-593076134892109838", businessId: "382987965776199683", source: "thumbtack_webhook" as const };
    const readCaptured = vi.fn(async () => [captured]);
    const caller = createReviewResponsesRouter(getService, readCaptured).createCaller({ req: {} as any, res: {} as any, user: null });
    mocks.auth.mockResolvedValue(null);
    await expect(caller.importCaptured()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.auth.mockResolvedValue({ isAdmin: false, agentEmail: "staff@example.invalid" });
    await expect(caller.importCaptured()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readCaptured).not.toHaveBeenCalled(); expect(getService).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ isAdmin: true, agentEmail: "admin@example.invalid" });
    await caller.importCaptured();
    expect(service.ingest).toHaveBeenCalledWith(captured, "admin@example.invalid");
    expect(readCaptured).toHaveBeenCalledTimes(1);
    expect(service.generate).not.toHaveBeenCalled(); expect(service.publish).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and non-admin staff before service access", async () => {
    const { caller, getService } = setup(); mocks.auth.mockResolvedValue(null);
    await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.auth.mockResolvedValue({ isAdmin: false, agentEmail: "staff@example.invalid" });
    await expect(caller.generate({ key })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getService).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("reports locked flags without storage, provider, or runtime activation", async () => {
    const { caller, getService } = setup(); mocks.auth.mockResolvedValue({ isAdmin: true, agentEmail: "admin@example.invalid" });
    expect(await caller.status()).toMatchObject({ monitoringEnabled: false, publicationEnabled: false, autoPublishEnabled: false, mode: "draft_only", providerAccessVerified: false, capturedThumbtackImportAvailable: true, currentPublicReplyStatus: "unverified" });
    expect(getService).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("uses authenticated server actor for manual import/edit/approve", async () => {
    const { caller, service } = setup(); mocks.auth.mockResolvedValue({ isAdmin: true, agentEmail: "admin@example.invalid" });
    await caller.ingest(review); await caller.edit({ key, text: "Manual response", expectedRevision: 2 }); await caller.approve({ key, expectedRevision: 3 });
    expect(service.ingest).toHaveBeenCalledWith(review, "admin@example.invalid");
    expect(service.edit).toHaveBeenCalledWith(key, "Manual response", 2, "admin@example.invalid");
    expect(service.approve).toHaveBeenCalledWith(key, 3, "admin@example.invalid");
  });
  it("cannot spoof a native provider source through manual entry", async () => {
    const { caller, getService } = setup(); mocks.auth.mockResolvedValue({ isAdmin: true, agentEmail: "admin@example.invalid" });
    await expect(caller.ingest({ ...review, source: "google_api" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(getService).not.toHaveBeenCalled();
  });
  it("blocks direct publish even for admin before creating a service or checking the record", async () => {
    const { caller, getService, service } = setup(); mocks.auth.mockResolvedValue({ isAdmin: true, agentEmail: "admin@example.invalid" });
    await expect(caller.publish({ key })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getService).not.toHaveBeenCalled(); expect(service.publish).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("redacts raw failure bodies and credentials", async () => {
    const { caller, service } = setup(); mocks.auth.mockResolvedValue({ isAdmin: true, agentEmail: "admin@example.invalid" });
    service.list.mockRejectedValue(Error("sensitive-secret-provider-body"));
    await expect(caller.list()).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Review action could not complete. Refresh the review and check its validation or approval state." });
  });
});
