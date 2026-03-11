import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAgentSmsNotification, buildNewLeadAlert, notifyAgentOfLead, type LeadBriefing } from "./agentNotification";

// Mock sendSms from openphone
vi.mock("./openphone", () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
  estimatePrice: vi.fn().mockReturnValue("179"),
  normalizePhone: vi.fn((p: string) => p),
}));

// Mock notifyOwner from _core/notification
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

const baseLead: LeadBriefing = {
  name: "Rohan Smith",
  phone: "+13029816191",
  serviceType: "Standard Cleaning",
  bedrooms: "3 Bedrooms",
  bathrooms: "2 Bathrooms",
  price: "259",
  selectedSlot: "Thursday 1PM",
  address: "123 Main St, Washington DC 20001",
};

describe("buildAgentSmsNotification", () => {
  it("includes the lead name", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("Rohan Smith");
  });

  it("includes the phone number", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("+13029816191");
  });

  it("includes the service type", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("Standard Cleaning");
  });

  it("includes the quoted price", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("$259");
  });

  it("includes the selected slot", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("Thursday 1PM");
  });

  it("includes the address", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("123 Main St");
  });

  it("includes the callback urgency message", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("call them back ASAP");
  });

  it("shows size as sqft for office cleaning", () => {
    const officeLead: LeadBriefing = {
      ...baseLead,
      serviceType: "Office Cleaning",
      bedrooms: "1,000–2,000 sq ft",
      bathrooms: "",
    };
    const msg = buildAgentSmsNotification(officeLead);
    expect(msg).toContain("1,000–2,000 sq ft");
    expect(msg).not.toContain("/ ");
  });

  it("shows bedroom/bathroom for residential cleaning", () => {
    const msg = buildAgentSmsNotification(baseLead);
    expect(msg).toContain("3 Bedrooms / 2 Bathrooms");
  });

  it("works without optional fields", () => {
    const minimalLead: LeadBriefing = {
      name: "Jane",
      phone: "+12025551234",
      serviceType: "Deep Cleaning",
      bedrooms: "2 Bedrooms",
      bathrooms: "1 Bathroom",
      price: "329",
    };
    const msg = buildAgentSmsNotification(minimalLead);
    expect(msg).toContain("Jane");
    expect(msg).toContain("$329");
    expect(msg).not.toContain("undefined");
  });
});

describe("buildNewLeadAlert", () => {
  it("includes the lead name", () => {
    const msg = buildNewLeadAlert({ name: "Alice", phone: "+12025551234", serviceType: "Standard Cleaning", bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", price: "209" });
    expect(msg).toContain("Alice");
  });

  it("includes the phone number", () => {
    const msg = buildNewLeadAlert({ name: "Alice", phone: "+12025551234", serviceType: "Standard Cleaning", bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", price: "209" });
    expect(msg).toContain("+12025551234");
  });

  it("includes the quoted price", () => {
    const msg = buildNewLeadAlert({ name: "Alice", phone: "+12025551234", serviceType: "Standard Cleaning", bedrooms: "2 Bedrooms", bathrooms: "1 Bathroom", price: "209" });
    expect(msg).toContain("$209");
  });

  it("shows sqft for office cleaning", () => {
    const msg = buildNewLeadAlert({ name: "Bob", phone: "+12025551234", serviceType: "Office Cleaning", bedrooms: "1,000\u20132,000 sq ft", bathrooms: "", price: "180" });
    expect(msg).toContain("1,000\u20132,000 sq ft");
  });

  it("does not contain undefined", () => {
    const msg = buildNewLeadAlert({ name: "Alice", phone: "+12025551234", serviceType: "Deep Cleaning", bedrooms: "3 Bedrooms", bathrooms: "2 Bathrooms", price: "349" });
    expect(msg).not.toContain("undefined");
  });
});

describe("notifyAgentOfLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendSms with the support number", async () => {
    const { sendSms } = await import("./openphone");
    await notifyAgentOfLead(baseLead);
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+12028885362" })
    );
  });

  it("calls notifyOwner with lead name and price in title", async () => {
    const { notifyOwner } = await import("./_core/notification");
    await notifyAgentOfLead(baseLead);
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Rohan Smith"),
      })
    );
  });

  it("does not throw if sendSms fails", async () => {
    const { sendSms } = await import("./openphone");
    vi.mocked(sendSms).mockRejectedValueOnce(new Error("SMS failed"));
    await expect(notifyAgentOfLead(baseLead)).resolves.not.toThrow();
  });

  it("does not throw if notifyOwner fails", async () => {
    const { notifyOwner } = await import("./_core/notification");
    vi.mocked(notifyOwner).mockRejectedValueOnce(new Error("Notification failed"));
    await expect(notifyAgentOfLead(baseLead)).resolves.not.toThrow();
  });
});
