import { describe, expect, it } from "vitest";
import { customerEmailBinding, emailSnapshotFromRawThread, emailSnapshotHash } from "./claudeCustomerEmailSource";

const mailbox = "office@example.com", receivedAt = 2000;
const encode = (text: string) => Buffer.from(text).toString("base64url");
function message(id = "gmail-current", date = "1000", extra: Array<{ name: string; value: string }> = []) {
  return { id, threadId: "thread-actual", internalDate: date, labelIds: ["INBOX", "UNREAD"], payload: {
    mimeType: "multipart/alternative", headers: [
      { name: "From", value: '"Lane, Maya" <Maya@Example.NET>' }, { name: "To", value: "Office <office@example.com>" },
      { name: "Subject", value: "Please update my cleaning" }, { name: "Message-ID", value: `<${id}@example.net>` },
      { name: "Date", value: "Mon, 16 Nov 2026 12:00:00 -0500" }, ...extra,
    ], parts: [
      { mimeType: "text/html", body: { data: encode("<p>Please add oven cleaning.</p>"), size: 33 } },
      { mimeType: "text/plain", body: { data: encode("Please add oven cleaning.\n\nFull original quote."), size: 45 } },
    ],
  } };
}
function raw(messages = [message()]) { return { id: "thread-actual", historyId: "mutable-history", messages }; }
function bind(thread = raw()) { return customerEmailBinding(emailSnapshotFromRawThread(thread, mailbox), "gmail-current", receivedAt); }
function replaceHeader(name: string, value: string) {
  const msg = message();
  msg.payload.headers = msg.payload.headers.filter(header => header.name.toLowerCase() !== name.toLowerCase());
  msg.payload.headers.push({ name, value });
  return raw([msg]);
}

describe("actual Gmail customer email source", () => {
  it("retains original complete raw headers, bodies, labels, date and history without mutating raw input", () => {
    const thread = raw([message("older", "500"), message()]), original = JSON.stringify(thread);
    const snapshot = emailSnapshotFromRawThread(thread, mailbox), binding = customerEmailBinding(snapshot, "gmail-current", receivedAt)!;
    expect(binding).not.toBeNull();
    expect(binding).toMatchObject({ mailboxEmail: mailbox, threadId: "thread-actual", inboundMessageId: "gmail-current",
      fromEmail: "maya@example.net", recipientEmail: "maya@example.net", senderName: "Lane, Maya", replyToEmail: null,
      subject: "Please update my cleaning", rfcMessageId: "<gmail-current@example.net>", createdAt: 1000, receivedAt,
      inboundText: "Please add oven cleaning.\n\nFull original quote." });
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1].headers).toEqual(Object.fromEntries(thread.messages[1].payload.headers.map(header => [header.name, header.value])));
    expect(snapshot.messages[1].html).toBe("<p>Please add oven cleaning.</p>");
    expect(snapshot.messages[1].labelIds).toEqual(["INBOX", "UNREAD"]);
    expect(binding.snapshot).toBe(snapshot);
    expect(binding.snapshotHash).toBe(emailSnapshotHash(snapshot));
    expect(binding.rfcMessageId).not.toBe(binding.inboundMessageId);
    expect(JSON.stringify(thread)).toBe(original);
  });

  it("uses the single actual Reply-To without guessing customer roles", () => {
    const thread = raw([message("gmail-current", "1000", [{ name: "Reply-To", value: '"Other, Real" <reply@example.org>' }])]);
    expect(bind(thread)).toMatchObject({ fromEmail: "maya@example.net", replyToEmail: "reply@example.org", recipientEmail: "reply@example.org" });
  });

  it.each(["maya@example.net, other@example.net", "Maya <maya@example.net>, Other <other@example.net>", "Group:maya@example.net;", "bad <maya@example.net> extra", "Maya <maya@example.net\r\nBcc: other@example.net>"])("rejects ambiguous/malformed From and Reply-To: %s", value => {
    expect(bind(replaceHeader("From", value))).toBeNull();
    expect(bind(replaceHeader("Reply-To", value))).toBeNull();
  });

  it.each(["From", "Reply-To", "Message-ID", "To"])("fails closed on duplicate routing header %s with all original values retained", name => {
    const values: Record<string, string> = { From: "maya@example.net", "Reply-To": "reply@example.net", "Message-ID": "<id@example.net>", To: mailbox };
    const msg = message("gmail-current", "1000", [{ name, value: values[name] }, { name: name.toLowerCase(), value: values[name] }]);
    const snapshot = emailSnapshotFromRawThread(raw([msg]), mailbox);
    expect(Object.values(snapshot.messages[0].headers).join("\n")).toContain(values[name]);
    expect(customerEmailBinding(snapshot, "gmail-current", receivedAt)).toBeNull();
  });

  it("rejects same-case repeated headers and never overwrites their original values", () => {
    const snapshot = emailSnapshotFromRawThread(raw([message("gmail-current", "1000", [{ name: "From", value: "other@example.net" }])]), mailbox);
    expect(snapshot.messages[0].headers.From).toBe('"Lane, Maya" <Maya@Example.NET>\nother@example.net');
    expect(customerEmailBinding(snapshot, "gmail-current", receivedAt)).toBeNull();
  });

  it.each(["office@example.com", "Office <OFFICE@example.com>"])("rejects self sender or self reply recipient: %s", value => {
    expect(bind(replaceHeader("From", value))).toBeNull();
    expect(bind(replaceHeader("Reply-To", value))).toBeNull();
  });

  it.each([["SENT", "INBOX"], ["INBOX", "DRAFT"], ["INBOX", "SPAM"], ["INBOX", "TRASH"], ["UNREAD"], []].map(labels => [labels]))("requires actual inbox inbound labels, not SENT/draft/spam/trash: %j", labels => {
    const msg = message(); msg.labelIds = labels;
    expect(bind(raw([msg]))).toBeNull();
  });

  it("requires an actual routing header to the real mailbox, including delivery headers for Bcc", () => {
    expect(bind(replaceHeader("To", "other@example.net"))).toBeNull();
    const thread = replaceHeader("To", "other@example.net");
    thread.messages[0].payload.headers.push({ name: "Delivered-To", value: mailbox });
    expect(bind(thread)).not.toBeNull();
  });

  it.each([
    ["Auto-Submitted", "auto-generated"], ["Auto-Submitted", "auto-replied"], ["List-ID", "staff.example.net"], ["List-Unsubscribe", "<mailto:list@example.net>"],
    ["Precedence", "bulk"], ["Precedence", "list"], ["Return-Path", "<>"], ["Content-Type", 'multipart/report; report-type="delivery-status"'],
    ["X-Autoreply", "yes"], ["X-Autorespond", "yes"], ["X-Failed-Recipients", mailbox],
  ])("excludes bot/list/bounce by verified original %s header", (name, value) => {
    expect(bind(raw([message("gmail-current", "1000", [{ name, value }])]))).toBeNull();
  });

  it("does not guess bots from customer body, subject, display name or ordinary return path", () => {
    const thread = raw([message("gmail-current", "1000", [{ name: "Auto-Submitted", value: "no" }, { name: "Return-Path", value: "<maya@example.net>" }])]);
    thread.messages[0].payload.headers.find(header => header.name === "Subject")!.value = "Please unsubscribe me from a newsletter";
    expect(bind(thread)).not.toBeNull();
  });

  it.each(["noreply@example.net", "no-reply@example.net", "do-not-reply@example.net", "mailer-daemon@example.net", "postmaster@example.net"])("excludes actual no-reply/bounce address %s", email => {
    expect(bind(replaceHeader("From", email))).toBeNull();
    expect(bind(replaceHeader("Reply-To", email))).toBeNull();
  });

  it.each(["gmail-current", "missing", "<broken>", "<one@example.net> <two@example.net>", "<a b@example.net>"])("requires original valid RFC Message-ID, never substitutes Gmail ID: %s", value => {
    expect(bind(replaceHeader("Message-ID", value))).toBeNull();
  });

  it("rejects missing RFC Message-ID but accepts RFC dot-atom and domain literal IDs", () => {
    const thread = raw(); thread.messages[0].payload.headers = thread.messages[0].payload.headers.filter(header => header.name !== "Message-ID");
    expect(bind(thread)).toBeNull();
    expect(bind(replaceHeader("Message-ID", "<actual@localhost>"))).not.toBeNull();
    expect(bind(replaceHeader("Message-ID", "<actual@[127.0.0.1]>"))).not.toBeNull();
  });

  it("requires the unique latest actual message, with no historical anchor, duplicate IDs or ambiguous date tie", () => {
    expect(bind(raw([message(), message("newer", "1500")]))).toBeNull();
    expect(bind(raw([message(), message()]))).toBeNull();
    expect(bind(raw([message(), message("same-date", "1000")]))).toBeNull();
    const snapshot = emailSnapshotFromRawThread(raw(), mailbox);
    expect(customerEmailBinding(snapshot, "other", receivedAt)).toBeNull();
    expect(customerEmailBinding(snapshot, "cs-fallback-fake", receivedAt)).toBeNull();
    expect(customerEmailBinding(snapshot, "gmail-current", 999)).toBeNull();
    expect(customerEmailBinding(snapshot, "gmail-current", NaN)).toBeNull();
  });

  it.each(["1000wrong", "", "0", "-1", "1.5"])("rejects missing or invalid raw internalDate without fabricating a date: %s", date => {
    expect(() => emailSnapshotFromRawThread(raw([message("gmail-current", date)]), mailbox)).toThrow("INVALID_RAW_EMAIL_DATE");
  });

  it("retains all MIME parts and the entire history/body without clipping, quoted-history stripping or whitespace changes", () => {
    const msg = message(), complete = "Leading  spaces\n" + "Full text 🧹 ".repeat(30000) + "\nEnd quoted history.";
    msg.payload.parts[1].body.data = encode(complete);
    msg.payload.parts.push({ mimeType: "text/plain", body: { data: encode("Final MIME section."), size: 19 } });
    const history = Array.from({ length: 650 }, (_, index) => message(`older-${index}`, String(index + 1)));
    const snapshot = emailSnapshotFromRawThread(raw([...history, msg]), mailbox), binding = customerEmailBinding(snapshot, "gmail-current", receivedAt)!;
    expect(snapshot.messages).toHaveLength(651);
    expect(binding.inboundText).toBe(complete + "\nFinal MIME section.");
    expect(snapshot.messages[0].text).toContain("Full original quote.");
  });

  it("uses full original HTML for HTML-only messages and rejects an unavailable external text body", () => {
    const msg = message(); msg.payload.parts = [msg.payload.parts[0]];
    expect(bind(raw([msg]))?.inboundText).toBe("<p>Please add oven cleaning.</p>");
    (msg.payload.parts[0].body as any) = { attachmentId: "external", size: 600000 };
    expect(() => emailSnapshotFromRawThread(raw([msg]), mailbox)).toThrow("EMAIL_BODY_NOT_COMPLETE");
  });

  it("hashes immutable original ID/date/order/headers/body/mailbox, not mutable labels or raw historyId", () => {
    const snapshot = emailSnapshotFromRawThread(raw([message("older", "500"), message()]), mailbox), hash = emailSnapshotHash(snapshot);
    const mutate = (fn: (value: typeof snapshot) => void) => { const copy = structuredClone(snapshot); fn(copy); return emailSnapshotHash(copy); };
    expect(mutate(value => { value.messages[1].labelIds = ["INBOX"]; })).toBe(hash);
    for (const fn of [
      (value: typeof snapshot) => { value.messages[1].text += "new"; }, (value: typeof snapshot) => { value.messages[1].html += "new"; },
      (value: typeof snapshot) => { value.messages[1].headers.Subject = "changed"; }, (value: typeof snapshot) => { value.messages[1].createdAt++; },
      (value: typeof snapshot) => { value.messages[1].id = "changed"; }, (value: typeof snapshot) => { value.mailboxEmail = "other@example.com"; },
      (value: typeof snapshot) => { value.messages.reverse(); },
    ]) expect(mutate(fn)).not.toBe(hash);
    const another = raw([message("older", "500"), message()]); another.historyId = "other-history";
    expect(emailSnapshotHash(emailSnapshotFromRawThread(another, mailbox))).toBe(hash);
  });
});
