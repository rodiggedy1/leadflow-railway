import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("isolated LeadFlow booking messages", () => {
  it("uses a LeadFlow-keyed table with an immutable message body and delivery audit", () => {
    const schema = read("drizzle/schema.ts");
    expect(schema).toContain('mysqlTable("leadflow_booking_messages"');
    expect(schema).toContain('leadflowJobId: int("leadflowJobId").notNull()');
    expect(schema).toContain('senderRole: varchar("senderRole", { length: 16 }).notNull()');
    expect(schema).toContain('notificationStatus: varchar("notificationStatus", { length: 24 }).notNull().default("not_applicable")');
  });

  it("allows a cleaner only through the isolated active team-owned LeadFlow job path", () => {
    const router = read("server/cleanerPortalMessagesRouter.ts");
    expect(router).toContain("cleanerProcedure");
    expect(router).toContain("eq(leadflowJobs.teamId, cleaner.teamId)");
    expect(router).toContain('ne(leadflowJobs.bookingStatus, "missing_from_launch27")');
    expect(router).not.toContain("cleanerJobs");
  });

  it("saves the cleaner message, then notifies the customer with the exact message and existing My Home link", () => {
    const router = read("server/cleanerPortalMessagesRouter.ts");
    expect(router).toContain('senderRole: "cleaner"');
    expect(router).toContain("getOrCreateCustomerPortalMagicLink");
    expect(router).toContain("view=messages");
    expect(router).toContain("Your Maids in Black cleaning team sent you a direct message:");
    expect(router).toContain("Reply in your portal:");
    expect(router).toContain('notificationStatus: "failed"');
  });

  it("keeps customer replies inside an authenticated matching LeadFlow booking thread and notifies the assigned cleaner", () => {
    const router = read("server/customerPortalRouter.ts");
    expect(router).toContain("replyToMessageThread");
    expect(router).toContain("getCustomerPortalSessionFromRequest");
    expect(router).toContain('senderRole: "customer"');
    expect(router).toContain("customerPortalAccountId: account.id");
    expect(router).toContain("getOrCreateCleanerMagicLink");
    expect(router).toContain("cleanerProfiles.launch27TeamId");
    expect(router).toContain("job.customerName");
    expect(router).toContain("sent you a response:");
    expect(router).toContain("Reply in your portal:");
    expect(router).toContain("to: cleaner.phone");
  });

  it("opens only the known Messages view after a valid customer portal handoff", () => {
    const handoff = read("server/customerPortalHandoffRoute.ts");
    expect(handoff).toContain('req.query.view === "messages" ? "/my-home?view=messages" : "/my-home"');
  });

  it("adds the Contact client panel only to active Cleaner Portal jobs and makes Customer Portal Messages real", () => {
    const cleanerUi = read("client/src/pages/CleanerPortalConnected.tsx");
    const customerUi = read("client/src/pages/CustomerPortal.tsx");
    expect(cleanerUi).toContain("function ContactClientPanel");
    expect(cleanerUi).toContain("Contact client");
    expect(cleanerUi).toContain("trpc.cleanerPortalMessages.send.useMutation");
    expect(cleanerUi).toContain("refetchInterval: 3_000");
    expect(customerUi).toContain("trpc.customerPortal.messages.useQuery");
    expect(customerUi).toContain("replyToMessageThread");
    expect(customerUi).not.toContain("Messages are not available in this portal yet.");
  });

  it("allows staff to review the same LeadFlow booking thread in Booking details", () => {
    const bookingRouter = read("server/leadflowJobsRouter.ts");
    const bookingUi = read("client/src/components/NativeBookingsWorkspace.tsx");
    expect(bookingRouter).toContain("staffMessages");
    expect(bookingUi).toContain("BookingMessageReview");
    expect(bookingUi).toContain("Cleaner & customer");
  });

  it("registers the table migration with a matching checksum and no destructive SQL", () => {
    const migration = read("server/versioned-migrations/0032_create_leadflow_booking_messages.sql");
    const manifest = JSON.parse(read("server/versioned-migrations/manifest.json"));
    const entry = manifest.migrations.find((item: { id: string }) => item.id === "0032_create_leadflow_booking_messages");
    expect(entry).toMatchObject({ mode: "create-table", sqlFile: "0032_create_leadflow_booking_messages.sql", postconditionsFile: "0032_create_leadflow_booking_messages.postconditions.json" });
    expect(entry.sha256).toBe(createHash("sha256").update(migration).digest("hex"));
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  });
});
