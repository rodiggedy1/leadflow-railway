/**
 * SenderPoliciesPage — manage per-sender / per-domain inbox filter rules.
 * Accessible at /admin/inbox/sender-policies
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff, Trash2, Plus, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export default function SenderPoliciesPage() {
  const utils = trpc.useUtils();
  const policiesQuery = trpc.gmail.listSenderPolicies.useQuery(undefined, { staleTime: 30_000, retry: false });

  const [newEmail, setNewEmail] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newIsActionable, setNewIsActionable] = useState<0 | 1>(0);
  const [addMode, setAddMode] = useState<"email" | "domain">("domain");
  const [showAdd, setShowAdd] = useState(false);

  const upsertMutation = trpc.gmail.upsertSenderPolicy.useMutation({
    onSuccess: (data) => {
      utils.gmail.listSenderPolicies.invalidate();
      utils.gmail.listThreads.invalidate();
      utils.gmail.getUnreadCount.invalidate();
      setNewEmail("");
      setNewDomain("");
      setNewLabel("");
      setShowAdd(false);
      toast.success(`Policy saved — ${data.threadsUpdated} thread(s) updated`);
    },
    onError: (err) => toast.error(err.message || "Failed to save policy"),
  });

  const deleteMutation = trpc.gmail.deleteSenderPolicy.useMutation({
    onSuccess: (data) => {
      utils.gmail.listSenderPolicies.invalidate();
      utils.gmail.listThreads.invalidate();
      utils.gmail.getUnreadCount.invalidate();
      toast.success(`Policy deleted — ${data.threadsReResolved} thread(s) re-resolved`);
    },
    onError: (err) => toast.error(err.message || "Failed to delete policy"),
  });

  function handleAdd() {
    if (addMode === "email" && !newEmail.trim()) { toast.error("Email is required"); return; }
    if (addMode === "domain" && !newDomain.trim()) { toast.error("Domain is required"); return; }
    upsertMutation.mutate({
      senderEmail: addMode === "email" ? newEmail.trim().toLowerCase() : undefined,
      senderDomain: addMode === "domain" ? newDomain.trim().toLowerCase().replace(/^@/, "") : undefined,
      isActionable: newIsActionable,
      label: newLabel.trim() || undefined,
    });
  }

  const policies = policiesQuery.data?.policies ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/inbox">
            <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back to inbox
            </button>
          </Link>
        </div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Sender Policies</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Control which senders appear in the default inbox view. Ignored senders are hidden from the badge and thread list unless you toggle "Show all".
            </p>
          </div>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)} className="gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />
            Add rule
          </Button>
        </div>

        {showAdd && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 shadow-sm space-y-3">
            <p className="text-xs font-semibold text-slate-600">New rule</p>
            <div className="flex gap-2">
              {(["domain", "email"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAddMode(m)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors",
                    addMode === m
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  )}
                >
                  {m === "domain" ? "By domain" : "By email"}
                </button>
              ))}
            </div>
            {addMode === "domain" ? (
              <Input
                placeholder="e.g. thumbtack.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="text-sm h-8"
              />
            ) : (
              <Input
                placeholder="e.g. notifications@thumbtack.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="text-sm h-8"
              />
            )}
            <Input
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="text-sm h-8"
            />
            <div className="flex gap-2">
              {([0, 1] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setNewIsActionable(v)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 transition-colors",
                    newIsActionable === v
                      ? v === 0
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-green-600 text-white border-green-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  )}
                >
                  {v === 0 ? <ShieldOff className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                  {v === 0 ? "Ignore (hide)" : "Actionable (show)"}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)} className="text-xs flex-1">Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={upsertMutation.isPending} className="text-xs flex-1 gap-1.5">
                {upsertMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Save rule
              </Button>
            </div>
          </div>
        )}

        {policiesQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
          </div>
        ) : policies.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No sender rules yet</p>
            <p className="text-xs mt-1">All senders are treated as actionable by default.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {policies.map((p) => (
              <div key={p.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
                <div className={cn(
                  "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
                  p.isActionable ? "bg-green-100" : "bg-amber-100"
                )}>
                  {p.isActionable
                    ? <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                    : <ShieldOff className="w-3.5 h-3.5 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {p.senderEmail ?? (p.senderDomain ? `@${p.senderDomain}` : "—")}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {p.label ?? (p.isActionable ? "Actionable" : "Ignored")}
                    {p.senderDomain && !p.senderEmail && <span className="ml-1.5 text-slate-300">· domain rule</span>}
                    {p.senderEmail && <span className="ml-1.5 text-slate-300">· email rule</span>}
                  </p>
                </div>
                <button
                  onClick={() => deleteMutation.mutate({ id: p.id })}
                  disabled={deleteMutation.isPending}
                  className="flex-shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Delete rule"
                >
                  {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
