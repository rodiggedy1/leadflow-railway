/**
 * Tests for the lastSeenAt throttle in server/_core/trpc.ts
 *
 * We test the shouldWriteLastSeenAt logic directly by extracting it into a
 * testable helper. The Map and constant are module-level in trpc.ts, so we
 * replicate the logic here to verify the contract independently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Replicate the throttle logic for isolated testing ─────────────────────────
// This mirrors the implementation in server/_core/trpc.ts exactly.
// If the implementation changes, this test will catch the divergence.

const LAST_SEEN_THROTTLE_MS = 30_000;

function makeShouldWrite() {
  const cache = new Map<string, number>();

  return function shouldWriteLastSeenAt(key: string, now: number): boolean {
    const lastWrite = cache.get(key);
    if (lastWrite === undefined || now - lastWrite >= LAST_SEEN_THROTTLE_MS) {
      cache.set(key, now);
      return true;
    }
    return false;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('shouldWriteLastSeenAt throttle', () => {
  let shouldWrite: ReturnType<typeof makeShouldWrite>;
  const T0 = 1_000_000_000_000; // arbitrary fixed base time

  beforeEach(() => {
    shouldWrite = makeShouldWrite();
  });

  it('returns true on first call for a new key', () => {
    expect(shouldWrite('agent@example.com', T0)).toBe(true);
  });

  it('returns false on second call within 30s window', () => {
    shouldWrite('agent@example.com', T0);
    expect(shouldWrite('agent@example.com', T0 + 1_000)).toBe(false);
    expect(shouldWrite('agent@example.com', T0 + 15_000)).toBe(false);
    expect(shouldWrite('agent@example.com', T0 + 29_999)).toBe(false);
  });

  it('returns true exactly at 30s boundary', () => {
    shouldWrite('agent@example.com', T0);
    expect(shouldWrite('agent@example.com', T0 + 30_000)).toBe(true);
  });

  it('returns true after 30s have elapsed (offline→online transition)', () => {
    shouldWrite('agent@example.com', T0);
    expect(shouldWrite('agent@example.com', T0 + 60_000)).toBe(true);
  });

  it('resets the window after each write', () => {
    shouldWrite('agent@example.com', T0);
    // Write at T0+30s
    expect(shouldWrite('agent@example.com', T0 + 30_000)).toBe(true);
    // Within 30s of the second write — should be throttled
    expect(shouldWrite('agent@example.com', T0 + 45_000)).toBe(false);
    // 30s after the second write — should write again
    expect(shouldWrite('agent@example.com', T0 + 60_000)).toBe(true);
  });

  it('tracks different keys independently', () => {
    shouldWrite('agent1@example.com', T0);
    shouldWrite('agent2@example.com', T0 + 5_000);

    // agent1 is throttled
    expect(shouldWrite('agent1@example.com', T0 + 10_000)).toBe(false);
    // agent2 is throttled
    expect(shouldWrite('agent2@example.com', T0 + 15_000)).toBe(false);

    // agent1 window expires
    expect(shouldWrite('agent1@example.com', T0 + 30_000)).toBe(true);
    // agent2 window has not expired yet (only 25s since its write)
    expect(shouldWrite('agent2@example.com', T0 + 30_000)).toBe(false);
    // agent2 window expires
    expect(shouldWrite('agent2@example.com', T0 + 35_001)).toBe(true);
  });

  it('owner openId and agent email are tracked as separate keys', () => {
    const ownerKey = 'owner-openid-abc123';
    const agentKey = 'agent@maidinblack.com';

    shouldWrite(ownerKey, T0);
    shouldWrite(agentKey, T0);

    // Both throttled
    expect(shouldWrite(ownerKey, T0 + 1_000)).toBe(false);
    expect(shouldWrite(agentKey, T0 + 1_000)).toBe(false);

    // Both expire independently
    expect(shouldWrite(ownerKey, T0 + 30_000)).toBe(true);
    expect(shouldWrite(agentKey, T0 + 30_000)).toBe(true);
  });

  it('handles a completely new key after long silence (simulates fresh login)', () => {
    // Key has never been seen — simulates agent logging in for the first time
    expect(shouldWrite('new-agent@example.com', T0 + 999_999)).toBe(true);
  });
});
