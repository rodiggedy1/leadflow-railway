import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Invoices exact live shell", () => {
  it("routes the live workspace through the approved review composition", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/InvoicesExactLive.tsx");
    const styles = read("client/src/pages/invoices-exact-live.css");

    expect(app).toContain("AdminInvoicesExactReviewRoute");
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/invoices"><InvoicesExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/invoices"} component={AdminInvoicesExactReviewRoute} />');
    expect(app).toContain('location === "/admin/invoices"');
    expect(app).not.toContain('<Route path={"/admin/invoices"} component={InvoiceManager} />');
    expect(shell).toContain('import "./invoices-review.css"');
    expect(shell).toContain('import "./invoices-exact-live.css"');
    expect(shell).toContain('className="invoices-review invoices-live-exact"');
    expect(shell).toContain('className="invoices-workbench"');
    expect(shell).toContain("invoice-detail invoice-detail--");
    expect(styles).toContain("Live behavior slots inside the approved Invoices review composition");
  });

  it("retains every existing invoice data path and action flow", () => {
    const shell = read("client/src/pages/InvoicesExactLive.tsx");
    const router = read("server/invoiceRouter.ts");

    expect(shell).toContain("trpc.invoice.listInvoices.useQuery");
    expect(shell).toContain("trpc.invoice.listTemplates.useQuery");
    expect(shell).toContain("trpc.invoice.createTemplate.useMutation");
    expect(shell).toContain("trpc.invoice.updateTemplate.useMutation");
    expect(shell).toContain("trpc.invoice.deleteTemplate.useMutation");
    expect(shell).toContain("trpc.invoice.generateInvoice.useMutation");
    expect(shell).toContain("trpc.invoice.sendByEmail.useMutation");
    expect(shell).toContain("trpc.invoice.markAsPaid.useMutation");
    expect(shell).toContain("trpc.invoice.unmarkAsPaid.useMutation");
    expect(shell).toContain("trpc.invoice.deleteInvoice.useMutation");
    expect(shell).toContain("window.open(invoice.pdfUrl");
    expect(router).toContain("createTemplate: adminAgentProcedure");
    expect(router).toContain("generateInvoice: adminAgentProcedure");
    expect(router).toContain("sendByEmail: adminAgentProcedure");
    expect(router).toContain("markAsPaid: adminAgentProcedure");
    expect(router).toContain("unmarkAsPaid: adminAgentProcedure");
  });
});
