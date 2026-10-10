import { useMemo } from "react";
import { Bot, Check, LockKeyhole, ShieldCheck, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./ai-actions-control-center.css";

const MODES = [
  { value: "approval_required", label: "Approval required", description: "Madison can prepare it, but a human must approve execution.", icon: LockKeyhole },
  { value: "suggest_only", label: "Suggest only", description: "Madison can recommend the action; it never executes it.", icon: Sparkles },
  { value: "automatic", label: "Automatic", description: "Madison may execute this action without a per-item approval.", icon: Bot },
] as const;

function titleCase(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function AiActionsControlCenter() {
  const utils = trpc.useUtils();
  const { data: policies = [], isLoading, error } = trpc.aiActions.listPolicies.useQuery();
  const updatePolicy = trpc.aiActions.updatePolicy.useMutation({
    onSuccess: async () => { await utils.aiActions.listPolicies.invalidate(); toast.success("AI action policy saved."); },
    onError: (err) => toast.error(err.message),
  });
  const grouped = useMemo(() => policies.reduce<Record<string, typeof policies>>((groups, policy) => {
    (groups[policy.category] ??= []).push(policy); return groups;
  }, {}), [policies]);

  if (isLoading) return <main className="ai-actions-page"><div className="ai-actions-loading">Loading AI action policies…</div></main>;
  if (error) return <main className="ai-actions-page"><div className="ai-actions-error">Could not load AI action policies: {error.message}</div></main>;
  return (
    <main className="ai-actions-page" data-live-workspace="ai-actions">
      <header className="ai-actions-hero">
        <div><div className="ai-actions-eyebrow"><Bot size={15} /> AI OPERATIONS CONTROL CENTER</div><h1>AI Actions &amp; Autonomy</h1><p>Choose what Madison may understand, suggest, prepare, and eventually execute for this business.</p></div>
        <div className="ai-actions-safety"><ShieldCheck size={18} /><span><strong>Safe default</strong><br />New actions require approval.</span></div>
      </header>
      <section className="ai-actions-callout"><Check size={17} /><div><strong>Current operating rule</strong><span>Madison’s customer replies and operational tasks remain human-approved unless you explicitly change a policy below.</span></div></section>
      <section className="ai-actions-groups">
        {Object.entries(grouped).map(([category, categoryPolicies]) => <section className="ai-actions-group" key={category}><div className="ai-actions-group-title"><span>{titleCase(category)}</span><small>{categoryPolicies.length} actions</small></div>{categoryPolicies.map((policy) => <article className="ai-action-card" key={policy.actionKey}><div className="ai-action-copy"><div className="ai-action-title"><span className="ai-action-dot" />{policy.label}</div><p>{policy.description}</p><code>{policy.actionKey}</code></div><div className="ai-action-controls"><label className="ai-action-toggle"><input type="checkbox" checked={Boolean(policy.enabled)} onChange={(event) => updatePolicy.mutate({ actionKey: policy.actionKey, mode: policy.mode, enabled: event.target.checked })} />{policy.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}<span>{policy.enabled ? "Enabled" : "Disabled"}</span></label><div className="ai-action-mode-list">{MODES.map(({ value, label, description, icon: Icon }) => <button key={value} type="button" className={policy.mode === value ? "is-selected" : ""} onClick={() => policy.mode !== value && updatePolicy.mutate({ actionKey: policy.actionKey, mode: value, enabled: Boolean(policy.enabled) })}><Icon size={14} /><span><strong>{label}</strong><small>{description}</small></span></button>)}</div></div></article>)}</section>)}
      </section>
    </main>
  );
}
