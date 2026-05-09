/**
 * IssueDialog — AI Call Command Center
 *
 * Opened when a dispatcher clicks the alert (⚠) button on a job card.
 * Flow:
 *   1. Dispatcher selects the issue type
 *   2. System fetches suggested templates + pre-filled variables from the schedule
 *   3. Dispatcher selects a template, reviews/edits the resolved script
 *   4. Dispatcher selects the call target (team or client) and phone number
 *   5. Dispatcher fires the call → VAPI outbound call is placed
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertTriangle, Phone, PhoneCall, Loader2, ChevronDown, ChevronUp,
  User, Users, CheckCircle2, Edit3,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type IssueType =
  | "late_team" | "no_access" | "parking" | "delay" | "lockout"
  | "utility_issue" | "no_checkin" | "completion" | "manual";

interface SuggestedTemplate {
  id: number;
  name: string;
  triggerType: string;
  targetType: string;
  scriptTemplate: string;
  variables: string[];
  prefilledScript: string;
}

interface IssueDialogProps {
  open: boolean;
  onClose: () => void;
  cleanerJobId: number;
  jobDate: string;
  /** Called after a call is successfully fired */
  onCallFired?: (callLogId: number) => void;
}

// ── Issue type options ────────────────────────────────────────────────────────

const ISSUE_TYPES: { value: IssueType; label: string; color: string }[] = [
  { value: "late_team",     label: "Late Team",        color: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "no_checkin",    label: "No Check-In",      color: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  { value: "no_access",     label: "No Access",        color: "bg-red-100 text-red-700 border-red-200" },
  { value: "lockout",       label: "Lockout",          color: "bg-red-100 text-red-700 border-red-200" },
  { value: "parking",       label: "Parking Issue",    color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "delay",         label: "Delay",            color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "utility_issue", label: "Utility Issue",    color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "completion",    label: "Completion",       color: "bg-green-100 text-green-700 border-green-200" },
  { value: "manual",        label: "Other / Manual",   color: "bg-gray-100 text-gray-700 border-gray-200" },
];

// ── Variable editor ───────────────────────────────────────────────────────────

function VariableEditor({
  variables,
  values,
  onChange,
}: {
  variables: string[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  const LABELS: Record<string, string> = {
    team_name: "Team Name",
    client_name: "Client Name",
    address: "Address",
    time: "Scheduled Time",
    new_eta: "New ETA",
    water_power_access: "Utility (water/power/access)",
  };

  return (
    <div className="space-y-2">
      {variables.map(v => (
        <div key={v} className="flex items-center gap-2">
          <Label className="w-36 shrink-0 text-xs text-gray-500">{LABELS[v] ?? v}</Label>
          <Input
            value={values[v] ?? ""}
            onChange={e => onChange(v, e.target.value)}
            placeholder={`{{${v}}}`}
            className="flex-1 h-7 text-sm"
          />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IssueDialog({
  open, onClose, cleanerJobId, jobDate, onCallFired,
}: IssueDialogProps) {
  const utils = trpc.useUtils();

  // ── Step state ───────────────────────────────────────────────────────────
  const [step, setStep] = useState<"issue" | "template" | "review">("issue");
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [issueId, setIssueId] = useState<number | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [resolvedScript, setResolvedScript] = useState("");
  const [callTarget, setCallTarget] = useState<"team" | "client">("team");
  const [calledPhone, setCalledPhone] = useState("");
  const [showVarEditor, setShowVarEditor] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // ── Server mutations ─────────────────────────────────────────────────────
  const raiseIssue = trpc.calls.raiseIssue.useMutation();
  const fireCall = trpc.calls.fireCall.useMutation({
    onSuccess: (data) => {
      toast.success("Call placed successfully");
      utils.calls.getCallLog.invalidate({ jobDate });
      utils.calls.getDayIssues.invalidate({ jobDate });
      onCallFired?.(data.callLogId);
      onClose();
    },
    onError: (e) => toast.error(`Call failed: ${e.message}`),
  });

  // ── Derived state ────────────────────────────────────────────────────────
  const suggestedTemplates: SuggestedTemplate[] = (raiseIssue.data?.suggestedTemplates ?? []) as SuggestedTemplate[];
  const selectedTemplate = suggestedTemplates.find(t => t.id === selectedTemplateId);
  const jobInfo = raiseIssue.data?.job;

  // ── Reset on open ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setStep("issue");
      setIssueType(null);
      setIssueId(null);
      setSelectedTemplateId(null);
      setVarValues({});
      setResolvedScript("");
      setCallTarget("team");
      setCalledPhone("");
      setShowVarEditor(false);
    }
  }, [open]);
  // ── Pre-fill phone when job info loads ───────────────────────────────────────
  useEffect(() => {
    if (!jobInfo) return;
    if (callTarget === "team") {
      // teamPhone is fetched from cleanerProfiles.phone server-side
      setCalledPhone((jobInfo as any).teamPhone ?? "");
    } else {
      setCalledPhone(jobInfo.customerPhone ?? "");
    }
  }, [jobInfo, callTarget]); // ── Resolve script when vars or template change ───────────────────────────
  useEffect(() => {
    if (!selectedTemplate) return;
    let script = selectedTemplate.scriptTemplate;
    for (const [k, v] of Object.entries(varValues)) {
      script = script.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v || `{{${k}}}`);
    }
    setResolvedScript(script);
  }, [selectedTemplate, varValues]);

  // ── Step 1: select issue type ─────────────────────────────────────────────
  async function handleSelectIssue(type: IssueType) {
    setIssueType(type);
    try {
      const result = await raiseIssue.mutateAsync({
        cleanerJobId,
        jobDate,
        issueType: type,
      });
      setIssueId(result.issueId);
      // Pre-fill variables from schedule data
      setVarValues(result.prefillVars as Record<string, string>);
      // Auto-select first suggested template
      if (result.suggestedTemplates.length > 0) {
        const first = result.suggestedTemplates[0] as SuggestedTemplate;
        setSelectedTemplateId(first.id);
        // Default call target based on template targetType
        setCallTarget(first.targetType === "client" ? "client" : "team");
      }
      setStep("template");
    } catch (e: any) {
      toast.error(`Failed to raise issue: ${e.message}`);
    }
  }

  // ── Step 2: select template ───────────────────────────────────────────────
  function handleSelectTemplate(t: SuggestedTemplate) {
    setSelectedTemplateId(t.id);
    setCallTarget(t.targetType === "client" ? "client" : "team");
    setStep("review");
  }

  // ── Step 3: fire call ─────────────────────────────────────────────────────
  function handleFireCallClick() {
    if (!issueId || !selectedTemplate || !resolvedScript || !calledPhone) {
      toast.error("Please fill in all required fields");
      return;
    }
    setShowConfirm(true);
  }

  async function handleFireCall() {
    setShowConfirm(false);
    if (!issueId || !selectedTemplate) return;
    await fireCall.mutateAsync({
      issueId: issueId!,
      cleanerJobId,
      jobDate,
      templateId: selectedTemplate!.id,
      resolvedScript,
      calledTarget: callTarget,
      calledPhone,
      teamName: jobInfo?.teamName ?? undefined,
      clientName: jobInfo?.customerName ?? undefined,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            AI Call Command Center
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Issue type ── */}
        {step === "issue" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">What's the issue with this job?</p>
            <div className="grid grid-cols-3 gap-2">
              {ISSUE_TYPES.map(it => (
                <button
                  key={it.value}
                  onClick={() => handleSelectIssue(it.value)}
                  disabled={raiseIssue.isPending}
                  className={`text-xs font-medium px-2 py-2 rounded-lg border transition-all hover:shadow-sm ${it.color}`}
                >
                  {it.label}
                </button>
              ))}
            </div>
            {raiseIssue.isPending && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading templates…
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Template selection ── */}
        {step === "template" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {ISSUE_TYPES.find(i => i.value === issueType)?.label}
              </Badge>
              <button
                onClick={() => setStep("issue")}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Change
              </button>
            </div>

            {suggestedTemplates.length === 0 ? (
              <p className="text-sm text-gray-400">No templates found for this issue type.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-500 font-medium">Select a call template:</p>
                {suggestedTemplates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t)}
                    className="w-full text-left p-3 rounded-xl border border-gray-100 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-gray-900">{t.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {t.targetType === "client" ? "→ Client" : "→ Team"}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-400 line-clamp-2">{t.prefilledScript}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Review & fire ── */}
        {step === "review" && selectedTemplate && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{selectedTemplate.name}</Badge>
              <button
                onClick={() => setStep("template")}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Change template
              </button>
            </div>

            {/* Variable editor (collapsible) */}
            {selectedTemplate.variables.length > 0 && (
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowVarEditor(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit variables
                  {showVarEditor
                    ? <ChevronUp className="w-3.5 h-3.5 ml-auto" />
                    : <ChevronDown className="w-3.5 h-3.5 ml-auto" />
                  }
                </button>
                {showVarEditor && (
                  <div className="p-3">
                    <VariableEditor
                      variables={selectedTemplate.variables}
                      values={varValues}
                      onChange={(k, v) => setVarValues(prev => ({ ...prev, [k]: v }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Resolved script */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Call Script (editable)</Label>
              <Textarea
                value={resolvedScript}
                onChange={e => setResolvedScript(e.target.value)}
                rows={5}
                className="text-sm resize-none"
                placeholder="The AI will read this script to the recipient…"
              />
            </div>

            {/* Call target */}
            <div>
              <Label className="text-xs text-gray-500 mb-2 block">Call Target</Label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCallTarget("team");
                    setCalledPhone((jobInfo as any)?.teamPhone ?? "");
                    // Auto-select team-targeted template if available
                    const teamTpl = suggestedTemplates.find(t => t.targetType === "team");
                    if (teamTpl) setSelectedTemplateId(teamTpl.id);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    callTarget === "team"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Team
                </button>
                <button
                  onClick={() => {
                    setCallTarget("client");
                    setCalledPhone(jobInfo?.customerPhone ?? "");
                    // Auto-select client-targeted template if available
                    const clientTpl = suggestedTemplates.find(t => t.targetType === "client");
                    if (clientTpl) setSelectedTemplateId(clientTpl.id);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    callTarget === "client"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  Client
                </button>
              </div>
            </div>

            {/* Phone number */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">Phone Number</Label>
              <Input
                value={calledPhone}
                onChange={e => setCalledPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="text-sm"
              />
              {callTarget === "team" && jobInfo?.teamName && (
                <p className="text-xs text-gray-400 mt-1">Team: {jobInfo.teamName}</p>
              )}
              {callTarget === "client" && jobInfo?.customerName && (
                <p className="text-xs text-gray-400 mt-1">Client: {jobInfo.customerName}</p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={fireCall.isPending}>
            Cancel
          </Button>
          {step === "review" && (
            <Button
              onClick={handleFireCallClick}
              disabled={fireCall.isPending || !calledPhone || !resolvedScript}
              className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
            >
              {fireCall.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Placing Call…</>
              ) : (
                <><PhoneCall className="w-4 h-4" /> Fire Call</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Confirmation popup ── */}
    <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="w-5 h-5 text-orange-500" />
            Confirm Call
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-gray-600">
            Placing a call to <span className="font-semibold">{callTarget === "team" ? jobInfo?.teamName ?? "Team" : jobInfo?.customerName ?? "Client"}</span>
          </p>
          <p className="text-sm font-mono bg-gray-50 rounded px-3 py-2 text-gray-800">{calledPhone}</p>
          <p className="text-xs text-gray-400 italic line-clamp-3">{resolvedScript}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
          <Button
            onClick={handleFireCall}
            disabled={fireCall.isPending}
            className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
          >
            {fireCall.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Calling…</>
            ) : (
              <><PhoneCall className="w-4 h-4" /> Confirm &amp; Call</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
