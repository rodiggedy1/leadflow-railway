import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runNormalStartup } from "./normalStartup";

describe("runNormalStartup", () => {
  it("runs only the required schema health check", async () => {
    const checkSmsCampaignSchema = vi.fn().mockResolvedValue(undefined);
    const confirmationRepair = vi.fn().mockResolvedValue(undefined);
    const opsRepair = vi.fn().mockResolvedValue(undefined);

    await runNormalStartup({ checkSmsCampaignSchema });

    expect(checkSmsCampaignSchema).toHaveBeenCalledTimes(1);
    expect(confirmationRepair).not.toHaveBeenCalled();
    expect(opsRepair).not.toHaveBeenCalled();
  });

  it("keeps legacy migration and repair execution out of the real server entrypoint", () => {
    const entrypoint = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

    expect(entrypoint).not.toContain("await runStartupMigrations();");
    expect(entrypoint).toContain("await runNormalStartup({ checkSmsCampaignSchema });");
    expect(entrypoint).not.toContain("runConfirmationCallRecoveryRepair(");
    expect(entrypoint).not.toContain("runOpsSmsCardDedupRepair(");
  });
});
