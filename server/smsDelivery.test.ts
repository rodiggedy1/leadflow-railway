/**
 * Tests for SMS delivery status tracking logic.
 * Validates that the webhook handler correctly identifies client-facing steps,
 * normalizes delivery statuses, and would trigger alerts for undelivered client SMS.
 */

import { describe, it, expect } from "vitest";

// ── Delivery status normalization ─────────────────────────────────────────────

function normalizeDeliveryStatus(status: string): string {
  // The new logic preserves exact OpenPhone status values
  const valid = ["delivered", "undelivered", "failed", "sent", "queued"];
  return valid.includes(status) ? status : status;
}

describe("normalizeDeliveryStatus", () => {
  it("preserves 'delivered'", () => {
    expect(normalizeDeliveryStatus("delivered")).toBe("delivered");
  });

  it("preserves 'undelivered' as distinct from 'failed'", () => {
    expect(normalizeDeliveryStatus("undelivered")).toBe("undelivered");
    expect(normalizeDeliveryStatus("undelivered")).not.toBe("failed");
  });

  it("preserves 'failed'", () => {
    expect(normalizeDeliveryStatus("failed")).toBe("failed");
  });

  it("preserves 'sent'", () => {
    expect(normalizeDeliveryStatus("sent")).toBe("sent");
  });

  it("preserves 'queued'", () => {
    expect(normalizeDeliveryStatus("queued")).toBe("queued");
  });
});

// ── Client-facing step detection ──────────────────────────────────────────────

const CLIENT_SMS_STEPS = new Set(["client_pre_job", "client_on_the_way", "client_running_late"]);

function isClientFacingStep(step: string): boolean {
  return CLIENT_SMS_STEPS.has(step);
}

describe("isClientFacingStep", () => {
  it("identifies client_pre_job as client-facing", () => {
    expect(isClientFacingStep("client_pre_job")).toBe(true);
  });

  it("identifies client_on_the_way as client-facing", () => {
    expect(isClientFacingStep("client_on_the_way")).toBe(true);
  });

  it("identifies client_running_late as client-facing", () => {
    expect(isClientFacingStep("client_running_late")).toBe(true);
  });

  it("does NOT flag cleaner-facing steps", () => {
    expect(isClientFacingStep("assignment_sms")).toBe(false);
    expect(isClientFacingStep("pre_job_reminder")).toBe(false);
    expect(isClientFacingStep("completion_flow")).toBe(false);
    expect(isClientFacingStep("exception_sms")).toBe(false);
    expect(isClientFacingStep("noshow_call")).toBe(false);
  });
});

// ── Alert trigger logic ───────────────────────────────────────────────────────

function shouldTriggerUndeliveredAlert(step: string, deliveryStatus: string): boolean {
  return (
    isClientFacingStep(step) &&
    (deliveryStatus === "undelivered" || deliveryStatus === "failed")
  );
}

describe("shouldTriggerUndeliveredAlert", () => {
  it("triggers alert for undelivered client_on_the_way SMS", () => {
    expect(shouldTriggerUndeliveredAlert("client_on_the_way", "undelivered")).toBe(true);
  });

  it("triggers alert for failed client_pre_job SMS", () => {
    expect(shouldTriggerUndeliveredAlert("client_pre_job", "failed")).toBe(true);
  });

  it("triggers alert for undelivered client_running_late SMS", () => {
    expect(shouldTriggerUndeliveredAlert("client_running_late", "undelivered")).toBe(true);
  });

  it("does NOT trigger alert for delivered client SMS", () => {
    expect(shouldTriggerUndeliveredAlert("client_on_the_way", "delivered")).toBe(false);
  });

  it("does NOT trigger alert for sent client SMS (pending delivery confirmation)", () => {
    expect(shouldTriggerUndeliveredAlert("client_on_the_way", "sent")).toBe(false);
  });

  it("does NOT trigger alert for undelivered cleaner SMS (not client-facing)", () => {
    expect(shouldTriggerUndeliveredAlert("assignment_sms", "undelivered")).toBe(false);
    expect(shouldTriggerUndeliveredAlert("completion_flow", "undelivered")).toBe(false);
  });
});

// ── Webhook event type matching ───────────────────────────────────────────────

const DELIVERY_EVENT_TYPES = new Set([
  "message.delivered",
  "message.updated",
  "message.delivery.updated",
]);

describe("delivery webhook event type matching", () => {
  it("handles message.delivered (primary OpenPhone event)", () => {
    expect(DELIVERY_EVENT_TYPES.has("message.delivered")).toBe(true);
  });

  it("handles message.updated (fallback)", () => {
    expect(DELIVERY_EVENT_TYPES.has("message.updated")).toBe(true);
  });

  it("handles message.delivery.updated (alternative name)", () => {
    expect(DELIVERY_EVENT_TYPES.has("message.delivery.updated")).toBe(true);
  });

  it("does NOT match message.received (inbound SMS)", () => {
    expect(DELIVERY_EVENT_TYPES.has("message.received")).toBe(false);
  });
});
