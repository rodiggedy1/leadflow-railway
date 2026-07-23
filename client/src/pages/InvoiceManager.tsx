/**
 * InvoiceManager — Create and manage invoice templates, generate PDFs.
 *
 * Sections:
 *   1. Template list (left panel) — search, select, create new
 *   2. Template editor (right panel) — form to create/edit templates
 *   3. Invoice history (bottom) — list of generated invoices with PDF download
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  FileText,
  Download,
  Loader2,
  Search,
  Edit3,
  ChevronRight,
  X,
  Receipt,
  ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  date: string;
  description: string;
  price: number;
}

interface Template {
  id: number;
  customerName: string;
  billTo: string;
  serviceAddress: string;
  stripeLink: string;
  lineItems: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceRecord {
  id: number;
  invoiceNumber: number;
  templateId: number;
  customerName: string;
  serviceDate: string;
  billingDate: string;
  stripeLink: string;
  lineItems: unknown;
  totalCents: number;
  pdfUrl: string | null;
  createdAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: unknown) => {
    const i = item as Record<string, unknown>;
    return {
      date: String(i.date ?? ""),
      description: String(i.description ?? ""),
      price: Number(i.price ?? 0),
    };
  });
}

// ─── Empty form state ─────────────────────────────────────────────────────────

function emptyForm() {
  return {
    customerName: "",
    billTo: "",
    serviceAddress: "",
    stripeLink: "",
    lineItems: [{ date: "", description: "", price: 0 }] as LineItem[],
  };
}

// ─── Line Items Editor ────────────────────────────────────────────────────────

function LineItemsEditor({
  items,
  onChange,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}) {
  const update = (idx: number, field: keyof LineItem, value: string | number) => {
    const next = items.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    );
    onChange(next);
  };

  const addRow = () => {
    onChange([...items, { date: "", description: "", price: 0 }]);
  };

  const removeRow = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const total = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[120px_1fr_90px_32px] gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
        <span>Date</span>
        <span>Description</span>
        <span className="text-right">Price ($)</span>
        <span />
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-[120px_1fr_90px_32px] gap-1 items-center">
          <Input
            value={item.date}
            onChange={(e) => update(idx, "date", e.target.value)}
            placeholder="June 29, 2026"
            className="h-8 text-sm"
          />
          <Input
            value={item.description}
            onChange={(e) => update(idx, "description", e.target.value)}
            placeholder="Cleaning Service — Hourly Service"
            className="h-8 text-sm"
          />
          <Input
            type="number"
            value={item.price === 0 ? "" : item.price}
            onChange={(e) => update(idx, "price", parseFloat(e.target.value) || 0)}
            placeholder="230.00"
            className="h-8 text-sm text-right"
            step="0.01"
            min="0"
          />
          <button
            type="button"
            onClick={() => removeRow(idx)}
            className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-red-500 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 text-xs text-[#C8573A] hover:text-[#a8472a] font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Add line item
        </button>
        <span className="text-sm font-semibold text-gray-700">
          Total: <span className="text-[#C8573A]">${total.toFixed(2)}</span>
        </span>
      </div>
    </div>
  );
}

// ─── Template Editor Panel ────────────────────────────────────────────────────

function TemplateEditor({
  template,
  onSaved,
  onCancel,
}: {
  template: Template | null; // null = create new
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(() =>
    template
      ? {
          customerName: template.customerName,
          billTo: template.billTo,
          serviceAddress: template.serviceAddress,
          stripeLink: template.stripeLink,
          lineItems: parseLineItems(template.lineItems),
        }
      : emptyForm()
  );

  // Reset form when template changes
  useEffect(() => {
    if (template) {
      setForm({
        customerName: template.customerName,
        billTo: template.billTo,
        serviceAddress: template.serviceAddress,
        stripeLink: template.stripeLink,
        lineItems: parseLineItems(template.lineItems),
      });
    } else {
      setForm(emptyForm());
    }
  }, [template?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const utils = trpc.useUtils();

  const createMut = trpc.invoice.createTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template created");
      utils.invoice.listTemplates.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMut = trpc.invoice.updateTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template saved");
      utils.invoice.listTemplates.invalidate();
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName.trim()) {
      toast.error("Customer name is required");
      return;
    }
    if (form.lineItems.length === 0) {
      toast.error("At least one line item is required");
      return;
    }
    if (template) {
      updateMut.mutate({ id: template.id, ...form });
    } else {
      createMut.mutate(form);
    }
  };

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">
          {template ? "Edit Template" : "New Template"}
        </h3>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Customer Name</label>
        <Input
          value={form.customerName}
          onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
          placeholder="Janice Minus-Rolle"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Bill To</label>
        <Textarea
          value={form.billTo}
          onChange={(e) => setForm((f) => ({ ...f, billTo: e.target.value }))}
          placeholder={"Janice Minus-Rolle\nMaids in Black C/o Permanent Mission\nChet Neymour (Permanent Mission / Chet Neymour)"}
          rows={3}
          className="text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Service Address</label>
        <Input
          value={form.serviceAddress}
          onChange={(e) => setForm((f) => ({ ...f, serviceAddress: e.target.value }))}
          placeholder="5127 Cathedral Ave NW, Washington, DC 20007"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Stripe Payment Link</label>
        <Input
          value={form.stripeLink}
          onChange={(e) => setForm((f) => ({ ...f, stripeLink: e.target.value }))}
          placeholder="https://buy.stripe.com/..."
          type="url"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Line Items</label>
        <LineItemsEditor
          items={form.lineItems}
          onChange={(items) => setForm((f) => ({ ...f, lineItems: items }))}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isPending} className="bg-[#C8573A] hover:bg-[#a8472a] text-white">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          {template ? "Save Changes" : "Create Template"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Generate Invoice Dialog ──────────────────────────────────────────────────

function GenerateDialog({
  template,
  onClose,
  onGenerated,
}: {
  template: Template;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [serviceDate, setServiceDate] = useState("");
  const [billingDate, setBillingDate] = useState("");
  const [stripeLink, setStripeLink] = useState(template.stripeLink);
  const [lineItems, setLineItems] = useState<LineItem[]>(parseLineItems(template.lineItems));
  const [result, setResult] = useState<{ pdfUrl: string; invoiceNumber: number } | null>(null);

  const utils = trpc.useUtils();
  const genMut = trpc.invoice.generateInvoice.useMutation({
    onSuccess: (data) => {
      setResult({ pdfUrl: data.pdfUrl, invoiceNumber: data.invoiceNumber });
      utils.invoice.listInvoices.invalidate();
      onGenerated();
      toast.success(`Invoice #${data.invoiceNumber} generated`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceDate.trim()) {
      toast.error("Service date is required");
      return;
    }
    genMut.mutate({
      templateId: template.id,
      serviceDate,
      billingDate: billingDate || undefined,
      stripeLink: stripeLink || undefined,
      lineItems: lineItems.length > 0 ? lineItems : undefined,
    });
  };

  const handleDownload = () => {
    if (!result) return;
    if (result.pdfUrl.startsWith("data:")) {
      // base64 fallback
      const a = document.createElement("a");
      a.href = result.pdfUrl;
      a.download = `Invoice_${result.invoiceNumber}_${template.customerName.replace(/\s+/g, "_")}.pdf`;
      a.click();
    } else {
      window.open(result.pdfUrl, "_blank");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 text-lg">
            Generate Invoice — {template.customerName}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Invoice #{result.invoiceNumber} ready!</p>
              <p className="text-sm text-gray-500 mt-1">PDF generated successfully</p>
            </div>
            <div className="flex gap-3 justify-center">
              <Button
                onClick={handleDownload}
                className="bg-[#C8573A] hover:bg-[#a8472a] text-white"
              >
                <Download className="w-4 h-4 mr-1" /> Download PDF
              </Button>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Service Date <span className="text-red-500">*</span>
                </label>
                <Input
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  placeholder="June 29, 2026"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Billing Date <span className="text-gray-400">(optional)</span>
                </label>
                <Input
                  value={billingDate}
                  onChange={(e) => setBillingDate(e.target.value)}
                  placeholder="Today"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Stripe Link <span className="text-gray-400">(override)</span>
              </label>
              <Input
                value={stripeLink}
                onChange={(e) => setStripeLink(e.target.value)}
                placeholder="https://buy.stripe.com/..."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Line Items <span className="text-gray-400">(edit for this invoice)</span>
              </label>
              <LineItemsEditor items={lineItems} onChange={setLineItems} />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                disabled={genMut.isPending}
                className="bg-[#C8573A] hover:bg-[#a8472a] text-white"
              >
                {genMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <FileText className="w-4 h-4 mr-1" />
                )}
                Generate PDF
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Invoice History Row ──────────────────────────────────────────────────────

function InvoiceRow({ inv, onDelete }: { inv: InvoiceRecord; onDelete: () => void }) {
  const utils = trpc.useUtils();
  const [emailSent, setEmailSent] = useState(false);
  const deleteMut = trpc.invoice.deleteInvoice.useMutation({
    onSuccess: () => {
      utils.invoice.listInvoices.invalidate();
      toast.success("Invoice deleted");
    },
    onError: (e) => toast.error(e.message),
  });
  const sendEmailMut = trpc.invoice.sendByEmail.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice #${data.invoiceNumber} sent to ${data.toEmail}`);
      setEmailSent(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleDownload = () => {
    if (!inv.pdfUrl) return;
    if (inv.pdfUrl.startsWith("data:")) {
      const a = document.createElement("a");
      a.href = inv.pdfUrl;
      a.download = `Invoice_${inv.invoiceNumber}_${inv.customerName.replace(/\s+/g, "_")}.pdf`;
      a.click();
    } else {
      window.open(inv.pdfUrl, "_blank");
    }
  };

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 text-sm">
      <td className="py-2 px-3 font-mono text-[#C8573A] font-semibold">#{inv.invoiceNumber}</td>
      <td className="py-2 px-3 text-gray-900">{inv.customerName}</td>
      <td className="py-2 px-3 text-gray-600">{inv.serviceDate}</td>
      <td className="py-2 px-3 text-gray-600">{inv.billingDate}</td>
      <td className="py-2 px-3 font-semibold text-gray-900">{formatCents(inv.totalCents)}</td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          {inv.pdfUrl ? (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          ) : (
            <span className="text-xs text-gray-400">No PDF</span>
          )}
          {inv.pdfUrl && (
            emailSent ? (
              <span className="text-xs text-green-600 font-medium">✓ Sent</span>
            ) : (
              <button
                onClick={() => sendEmailMut.mutate({ invoiceId: inv.id })}
                disabled={sendEmailMut.isPending}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
              >
                {sendEmailMut.isPending ? "Sending..." : "Email"}
              </button>
            )
          )}
          <button
            onClick={() => {
              if (confirm("Delete this invoice?")) {
                deleteMut.mutate({ id: inv.id });
                onDelete();
              }
            }}
            className="ml-2 text-gray-300 hover:text-red-500"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InvoiceManager() {
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null | "new">(null);
  const [generateFor, setGenerateFor] = useState<Template | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");

  const utils = trpc.useUtils();

  const { data: templates = [], isLoading: templatesLoading } = trpc.invoice.listTemplates.useQuery(
    { search: search || undefined },
    { staleTime: 30_000 }
  );

  const { data: invoiceList = [], isLoading: invoicesLoading } = trpc.invoice.listInvoices.useQuery(
    { search: invoiceSearch || undefined, limit: 100 },
    { staleTime: 30_000 }
  );

  const deleteTmplMut = trpc.invoice.deleteTemplate.useMutation({
    onSuccess: () => {
      utils.invoice.listTemplates.invalidate();
      setSelectedTemplate(null);
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminPageGuard pageId="invoices">
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activeTab="invoices" />

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          {/* Page title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#C8573A] flex items-center justify-center">
              <Receipt className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Invoice Manager</h1>
              <p className="text-sm text-gray-500">Manage templates and generate PDFs for customers</p>
            </div>
          </div>

          {/* Templates + Editor */}
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
            {/* Template list */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-3 border-b border-gray-100 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search templates..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#C8573A]"
                  />
                </div>
                <button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setEditingTemplate("new");
                  }}
                  className="flex items-center gap-1 text-xs bg-[#C8573A] text-white px-2.5 py-1.5 rounded-lg hover:bg-[#a8472a] font-medium whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" /> New
                </button>
              </div>

              {templatesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No templates yet</p>
                  <p className="text-xs mt-1">Create one to get started</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {(templates as Template[]).map((tmpl) => (
                    <li
                      key={tmpl.id}
                      onClick={() => {
                        setSelectedTemplate(tmpl);
                        setEditingTemplate(null);
                      }}
                      className={`flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                        selectedTemplate?.id === tmpl.id ? "bg-orange-50 border-l-2 border-[#C8573A]" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{tmpl.customerName}</p>
                        <p className="text-xs text-gray-500 truncate">{tmpl.serviceAddress}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 ml-2" />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Right panel: editor or template detail */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              {editingTemplate !== null ? (
                <TemplateEditor
                  template={editingTemplate === "new" ? null : editingTemplate}
                  onSaved={() => {
                    setEditingTemplate(null);
                    utils.invoice.listTemplates.invalidate();
                  }}
                  onCancel={() => setEditingTemplate(null)}
                />
              ) : selectedTemplate ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900 text-lg">{selectedTemplate.customerName}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{selectedTemplate.serviceAddress}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingTemplate(selectedTemplate)}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 px-2.5 py-1.5 rounded-lg"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete template for ${selectedTemplate.customerName}?`)) {
                            deleteTmplMut.mutate({ id: selectedTemplate.id });
                          }
                        }}
                        className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 px-2.5 py-1.5 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Bill To</p>
                      <p className="text-gray-700 whitespace-pre-line">{selectedTemplate.billTo}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Service Address</p>
                      <p className="text-gray-700">{selectedTemplate.serviceAddress}</p>
                    </div>
                  </div>

                  {selectedTemplate.stripeLink && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Stripe Link</p>
                      <a
                        href={selectedTemplate.stripeLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {selectedTemplate.stripeLink.slice(0, 60)}{selectedTemplate.stripeLink.length > 60 ? "..." : ""}
                      </a>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Line Items</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[#C8573A] text-white text-xs">
                          <th className="text-left py-1.5 px-2 rounded-tl font-semibold">Date</th>
                          <th className="text-left py-1.5 px-2 font-semibold">Description</th>
                          <th className="text-right py-1.5 px-2 rounded-tr font-semibold">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseLineItems(selectedTemplate.lineItems).map((item, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1.5 px-2 text-gray-600">{item.date}</td>
                            <td className="py-1.5 px-2 text-gray-900">{item.description}</td>
                            <td className="py-1.5 px-2 text-right font-medium">${item.price.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2} className="py-2 px-2 text-right text-sm font-bold text-[#C8573A]">Total</td>
                          <td className="py-2 px-2 text-right font-bold text-gray-900">
                            ${parseLineItems(selectedTemplate.lineItems).reduce((s, i) => s + i.price, 0).toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={() => setGenerateFor(selectedTemplate)}
                      className="bg-[#C8573A] hover:bg-[#a8472a] text-white"
                    >
                      <FileText className="w-4 h-4 mr-1.5" />
                      Generate Invoice PDF
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-gray-400">
                  <Receipt className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">Select a template or create a new one</p>
                </div>
              )}
            </div>
          </div>

          {/* Invoice History */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Invoice History</h2>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Search invoices..."
                  className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#C8573A] w-48"
                />
              </div>
            </div>

            {invoicesLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : (invoiceList as InvoiceRecord[]).length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No invoices generated yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left py-2 px-3">Invoice #</th>
                      <th className="text-left py-2 px-3">Customer</th>
                      <th className="text-left py-2 px-3">Service Date</th>
                      <th className="text-left py-2 px-3">Billing Date</th>
                      <th className="text-left py-2 px-3">Total</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoiceList as InvoiceRecord[]).map((inv) => (
                      <InvoiceRow
                        key={inv.id}
                        inv={inv}
                        onDelete={() => utils.invoice.listInvoices.invalidate()}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Generate Invoice Dialog */}
      {generateFor && (
        <GenerateDialog
          template={generateFor}
          onClose={() => setGenerateFor(null)}
          onGenerated={() => {
            utils.invoice.listInvoices.invalidate();
          }}
        />
      )}
    </AdminPageGuard>
  );
}
