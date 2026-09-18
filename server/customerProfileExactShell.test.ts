import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("Customer Profile exact review shell", () => {
  it("keeps the approved review composition while attaching only the existing selected conversation", () => {
    const page = read("client/src/pages/CustomerProfileExactLive.tsx");
    expect(page).toContain('import "./customer-profile-review.css";');
    expect(page).toContain('import "./customer-profile-portraits.css";');
    expect(page).toContain('import "./customer-profile-messages-command-stream.css";');
    expect(page).toContain('import "./customer-profile-live-exact.css";');
    expect(page).toContain('import { useLocation, useSearch } from "wouter";');
    expect(page).toContain("const params = useMemo(() => new URLSearchParams(search), [search]);");
    expect(page).toContain("trpc.leads.getCsConversation.useQuery");
    expect(page).toContain("trpc.leadflowJobs.customerProfile.useQuery");
    expect(page).toContain("trpc.leadflowJobs.customerDirectory.useQuery");
    expect(page).toContain("function CustomerDirectory");
    expect(page).toContain('data-live-customer-directory="true"');
    expect(page).toContain("hasRequestedDetail");
    expect(page).toContain('setLocation(`/admin/customer-profile?phone=${encodeURIComponent(customer.phone)}&name=${encodeURIComponent(customer.name)}`)');
    expect(page).toContain("CustomerCallEvidence");
    expect(page).toContain("CUSTOMER_CALL_BARS");
    expect(page).toContain("Continue in SMS");
    expect(page).not.toMatch(/\.useMutation\(/);
  });

  it("uses the dedicated LeadFlow-owned service-record profile read", () => {
    const jobsRouter = read("server/leadflowJobsRouter.ts");
    expect(jobsRouter).toContain("customerProfile: opsChatProcedure");
    expect(jobsRouter).toContain("customerDirectory: opsChatProcedure");
    expect(jobsRouter).toContain(".from(leadflowJobs)");
    expect(jobsRouter).toContain("const customers = new Map");
    expect(jobsRouter).toContain("customerNotes: leadflowJobs.customerNotes");
    expect(jobsRouter).toContain("hasStripeCard: Boolean(row.hasStripeCard)");
  });

  it("mounts the customer profile destination without global runtime chrome", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('const CustomerProfileExactLive = lazy(() => import("./pages/CustomerProfileExactLive"));');
    expect(app).toContain('function AdminCustomerProfileExactReviewRoute() { return <ReviewWorkspaceFrame navActivePath="/review/customer-profile"><CustomerProfileExactLive /></ReviewWorkspaceFrame>; }');
    expect(app).toContain('<Route path={"/admin/customer-profile"} component={AdminCustomerProfileExactReviewRoute} />');
    expect(app).toContain('location === "/admin/customer-profile"');
  });

  it("provides the new profile entry from the existing CS customer context", () => {
    const panel = read("client/src/components/CsRightPanelClient.tsx");
    expect(panel).toContain('/admin/customer-profile?sessionId=${selected.id}');
    expect(panel).toContain("Open profile");
  });
});
