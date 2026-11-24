import { describe, expect, it, vi } from "vitest";
import { createGenerationRecovery } from "./generationRecovery";

describe("one invocation-local extra content attempt", () => {
  it("returns a first valid result without a second attempt", async () => {
    const operation = vi.fn(async () => ({ replyText: "Hello" }));
    expect(await createGenerationRecovery().run(operation)).toEqual({ replyText: "Hello" });
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it.each([new Error("PROVIDER_FAILURE"), new SyntaxError("JSON_FAILURE"), new TypeError("SCHEMA_FAILURE"), "NON_ERROR_REJECTION"])("recovers every thrown failure once: %s", async error => {
    const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("validated");
    expect(await createGenerationRecovery().run(operation)).toBe("validated");
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it("propagates the actual second failure with no third attempt or fallback", async () => {
    const terminal = new Error("SECOND_FAILURE");
    const operation = vi.fn().mockRejectedValueOnce(new Error("FIRST_FAILURE")).mockRejectedValue(terminal);
    await expect(createGenerationRecovery().run(operation)).rejects.toBe(terminal);
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it("shares the one-extra budget when inner recovery succeeds but outer validation fails", async () => {
    const recovery = createGenerationRecovery(), invalid = new Error("QUOTE_VALIDATION_FAILED");
    const runner = vi.fn().mockRejectedValueOnce(new SyntaxError("FIRST_FAILURE")).mockResolvedValue("output");
    await expect(recovery.run(async () => {
      await recovery.run(runner);
      throw invalid;
    })).rejects.toBe(invalid);
    expect(runner).toHaveBeenCalledTimes(2);
  });
  it("uses the remaining one extra attempt for outer validation, then stops on inner failure", async () => {
    const recovery = createGenerationRecovery(), terminal = new Error("SECOND_PROVIDER_FAILURE");
    const runner = vi.fn().mockResolvedValueOnce("first invalid output").mockRejectedValue(terminal);
    await expect(recovery.run(async () => {
      await recovery.run(runner);
      throw new Error("OUTPUT_EVIDENCE_FAILED");
    })).rejects.toBe(terminal);
    expect(runner).toHaveBeenCalledTimes(2);
  });
  it("does not stack recovery after repeated inner failures", async () => {
    const recovery = createGenerationRecovery(), runner = vi.fn().mockRejectedValue(new Error("INVALID_OUTPUT"));
    await expect(recovery.run(() => recovery.run(runner))).rejects.toThrow("INVALID_OUTPUT");
    expect(runner).toHaveBeenCalledTimes(2);
  });
  it("does not invoke content work when already aborted", async () => {
    const controller = new AbortController(), reason = new Error("ORIGINAL_DEADLINE");
    controller.abort(reason);
    const operation = vi.fn();
    await expect(createGenerationRecovery(controller.signal).run(operation)).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();
  });
  it("preserves the first failure and starts no extra work after abort", async () => {
    const controller = new AbortController(), error = new Error("LATE_PROVIDER_FAILURE");
    const operation = vi.fn(async () => { controller.abort(); throw error; });
    await expect(createGenerationRecovery(controller.signal).run(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("does not turn an initial authorization/freshness failure into recovery", async () => {
    const guard = vi.fn().mockRejectedValue(new Error("UNAUTHORIZED")), operation = vi.fn();
    await expect(createGenerationRecovery().run(operation, guard)).rejects.toThrow("UNAUTHORIZED");
    expect(operation).not.toHaveBeenCalled(); expect(guard).toHaveBeenCalledTimes(1);
  });
  it("rechecks the original guard before recovery and stops if authority/context changed", async () => {
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("STALE_CONTEXT"));
    const operation = vi.fn().mockRejectedValue(new Error("PROVIDER_FAILURE"));
    await expect(createGenerationRecovery().run(operation, guard)).rejects.toThrow("STALE_CONTEXT");
    expect(operation).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalledTimes(2);
  });
  it("honors an abort during the recovery guard before calling content again", async () => {
    const controller = new AbortController(), reason = new Error("ORIGINAL_DEADLINE");
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(async () => { controller.abort(reason); });
    const operation = vi.fn().mockRejectedValue(new Error("FIRST_FAILURE"));
    await expect(createGenerationRecovery(controller.signal).run(operation, guard)).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("gives separate concurrent invocations independent two-attempt budgets", async () => {
    const a = vi.fn().mockRejectedValueOnce(new Error("A_FAILED")).mockResolvedValue("A");
    const b = vi.fn().mockRejectedValueOnce(new Error("B_FAILED")).mockResolvedValue("B");
    expect(await Promise.all([createGenerationRecovery().run(a), createGenerationRecovery().run(b)])).toEqual(["A", "B"]);
    expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(2);
  });
});
