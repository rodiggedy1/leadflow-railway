import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  sendSms: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./openphone", () => ({ sendSms: mocks.sendSms }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./routers", () => ({
  normalizePhone: vi.fn(),
  isValidUSPhone: vi.fn(),
}));

import { runScheduledFollowUp, runSilenceFollowUp } from "./followUpCron";
import { runNurtureSend } from "./nurtureCron";

describe("automatic lead outreach safety boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes silence follow-up a no-op before database, LLM, or SMS work", async () => {
    await expect(runSilenceFollowUp()).resolves.toEqual({ checked: 0, sent: 0, errors: 0 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });

  it("makes scheduled follow-up a no-op before database or SMS state changes", async () => {
    await expect(runScheduledFollowUp()).resolves.toEqual({ checked: 0, sent: 0, errors: 0 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });

  it("makes nurture delivery a no-op before database or SMS state changes", async () => {
    await expect(runNurtureSend()).resolves.toEqual({ checked: 0, sent: 0, ended: 0, errors: 0 });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
  });
});
