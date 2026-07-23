/**
 * MadisonDebugPanel — Madison's permanent regression dashboard.
 *
 * Test categories:
 *   1. Readiness Queries — gate passes, planner produces query plan, executor runs
 *   2. Cold-Session Referential Actions — gate passes, planner produces action plan,
 *      but no context → NEEDS_CONTEXT response (not FALLBACK, not HANDLED blindly)
 *   3. Stateful Acknowledge Sequences — seed query → acknowledge → verify DB state
 *   4. Off-Domain (must fall through) — gate rejects, returns FALLBACK
 *
 * Route: /madison-debug (admin-only via agent session)
 */
import { useState, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  FlaskConical,
  History,
  Zap,
  GitBranch,
  AlertTriangle,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpectedOutcome = "HANDLED" | "FALLBACK" | "NEEDS_CONTEXT";

interface SingleTestCase {
  kind: "single";
  id: string;
  category: string;
  message: string;
  expected: ExpectedOutcome;
  clearContext?: boolean;
  description?: string;
}

interface SequenceTestCase {
  kind: "sequence";
  id: string;
  category: string;
  seedMessage: string;
  acknowledgeMessage: string;
  description?: string;
}

type TestCase = SingleTestCase | SequenceTestCase;

interface PipelineStage {
  name: string;
  status: "pass" | "fail" | "skip";
}

interface DebugInfo {
  requestId?: string;
  gate?: {
    score: number;
    threshold: number;
    gateMatched: boolean;
    matchedConcepts: string[];
    matchedDimensions: string[];
    matchedActions: string[];
    matchedVerbs: string[];
    matchedTime: boolean;
  };
  plannerType?: string | null;
  plannerFailed?: boolean;
  plannerError?: string;
  executorInvoked?: boolean;
  executorError?: string;
  responseType?: string | null;
  needsContextReason?: string;
  acknowledgedCount?: number;
  durationMs?: number;
}

interface SingleTestResult {
  kind: "single";
  testId: string;
  status: "pending" | "running" | "pass" | "fail" | "error";
  durationMs?: number;
  response?: string | null;
  fallbackReason?: string | null;
  debug?: DebugInfo | null;
  error?: string;
}

interface SequenceTestResult {
  kind: "sequence";
  testId: string;
  status: "pending" | "running" | "pass" | "fail" | "error";
  durationMs?: number;
  seed?: { handled: boolean; response: string | null; debug: DebugInfo | null };
  acknowledge?: { handled: boolean; response: string | null; undoActionId: string | null; debug: DebugInfo | null };
  verification?: { executorSucceeded: boolean; acknowledgedCount: number; needsContext: boolean; persisted: boolean; seedItemCount: number; seedHadItems: boolean; verificationPassed: boolean; cleanupResult: "success" | "failed" | "skipped" };
  error?: string;
}

type TestResult = SingleTestResult | SequenceTestResult;

interface RunRecord {
  id: string;
  timestamp: number;
  gitCommit: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
}

// ─── Test Matrix ──────────────────────────────────────────────────────────────

const TESTS: TestCase[] = [
  // ── Readiness Queries ──────────────────────────────────────────────────────
  { kind: "single", id: "q-01", category: "Readiness Queries", message: "What needs attention tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-02", category: "Readiness Queries", message: "Show me readiness issues for tomorrow", expected: "HANDLED" },
  { kind: "single", id: "q-03", category: "Readiness Queries", message: "Which jobs have no cleaner tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-04", category: "Readiness Queries", message: "Any unassigned jobs tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-05", category: "Readiness Queries", message: "What's the readiness status for today?", expected: "HANDLED" },
  { kind: "single", id: "q-06", category: "Readiness Queries", message: "Show me tomorrow's readiness", expected: "HANDLED" },
  { kind: "single", id: "q-07", category: "Readiness Queries", message: "Any jobs missing a cleaner this week?", expected: "HANDLED" },
  { kind: "single", id: "q-08", category: "Readiness Queries", message: "What jobs need attention today?", expected: "HANDLED" },
  { kind: "single", id: "q-09", category: "Readiness Queries", message: "Show unconfirmed jobs for tomorrow", expected: "HANDLED" },
  { kind: "single", id: "q-10", category: "Readiness Queries", message: "Which jobs aren't ready for tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-11", category: "Readiness Queries", message: "Any payment issues tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-12", category: "Readiness Queries", message: "Show me jobs with missing access info tomorrow", expected: "HANDLED" },
  { kind: "single", id: "q-13", category: "Readiness Queries", message: "What readiness flags are there for next Monday?", expected: "HANDLED" },
  { kind: "single", id: "q-14", category: "Readiness Queries", message: "Show me all issues for this week", expected: "HANDLED" },
  { kind: "single", id: "q-15", category: "Readiness Queries", message: "Any schedule conflicts tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-16", category: "Readiness Queries", message: "Which jobs need a cleaner assigned for tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-17", category: "Readiness Queries", message: "Show me unassigned jobs for the next 3 days", expected: "HANDLED" },
  { kind: "single", id: "q-19", category: "Readiness Queries", message: "Show me tomorrow's problem jobs", expected: "HANDLED" },
  { kind: "single", id: "q-20", category: "Readiness Queries", message: "Any jobs without a confirmed team tomorrow?", expected: "HANDLED" },
  { kind: "single", id: "q-21", category: "Readiness Queries", message: "What issues do we have for tomorrow's schedule?", expected: "HANDLED" },
  { kind: "single", id: "q-22", category: "Readiness Queries", message: "Show readiness for tomorrow unassigned only", expected: "HANDLED" },
  { kind: "single", id: "q-23", category: "Readiness Queries", message: "Which jobs tomorrow still need a team?", expected: "HANDLED" },
  { kind: "single", id: "q-24", category: "Readiness Queries", message: "Show me all readiness flags for tomorrow", expected: "HANDLED" },
  { kind: "single", id: "q-25", category: "Readiness Queries", message: "What jobs are not ready for today?", expected: "HANDLED" },
  { kind: "single", id: "q-26", category: "Readiness Queries", message: "Any jobs missing payment authorization tomorrow?", expected: "HANDLED" },

  // ── Cold-Session Referential Actions ──────────────────────────────────────
  // These phrases are referential and require prior context.
  // In a cold session, Madison must respond with NEEDS_CONTEXT — not HANDLED blindly,
  // not FALLBACK. The response should ask the agent to show jobs first.
  {
    kind: "single", id: "c-01", category: "Cold-Session Referential Actions",
    message: "Acknowledge those issues", expected: "NEEDS_CONTEXT", clearContext: true,
    description: "Referential 'those' — requires prior query context",
  },
  {
    kind: "single", id: "c-02", category: "Cold-Session Referential Actions",
    message: "Mark that as ok", expected: "NEEDS_CONTEXT", clearContext: true,
    description: "Referential 'that' — requires prior query context",
  },
  {
    kind: "single", id: "c-03", category: "Cold-Session Referential Actions",
    message: "Dismiss those flags", expected: "NEEDS_CONTEXT", clearContext: true,
    description: "Referential 'those flags' — requires prior query context",
  },
  {
    kind: "single", id: "c-04", category: "Cold-Session Referential Actions",
    message: "That's fine", expected: "NEEDS_CONTEXT", clearContext: true,
    description: "Referential 'that' — requires prior query context",
  },
  {
    kind: "single", id: "c-05", category: "Cold-Session Referential Actions",
    message: "Mark them as handled", expected: "NEEDS_CONTEXT", clearContext: true,
    description: "Referential 'them' — requires prior query context",
  },

  // ── Stateful Acknowledge Sequences ────────────────────────────────────────
  // Each test: Step 1 = seed query (establishes context), Step 2 = acknowledge.
  // Context is cleared before Step 1 to ensure isolation.
  // Pass condition: executorSucceeded=true (acknowledgedCount=0 is valid when no items exist).
  {
    kind: "sequence", id: "s-01", category: "Stateful Acknowledge Sequences",
    seedMessage: "Which jobs have no cleaner tomorrow?",
    acknowledgeMessage: "Mark them as handled",
    description: "Seed: unassigned query → Ack: mark them",
  },
  {
    kind: "sequence", id: "s-02", category: "Stateful Acknowledge Sequences",
    seedMessage: "What needs attention tomorrow?",
    acknowledgeMessage: "Acknowledge those issues",
    description: "Seed: general readiness → Ack: acknowledge those",
  },
  {
    kind: "sequence", id: "s-03", category: "Stateful Acknowledge Sequences",
    seedMessage: "Show me readiness issues for tomorrow",
    acknowledgeMessage: "That's fine",
    description: "Seed: readiness issues → Ack: that's fine",
  },
  {
    kind: "sequence", id: "s-04", category: "Stateful Acknowledge Sequences",
    seedMessage: "Any unassigned jobs tomorrow?",
    acknowledgeMessage: "Mark that as ok",
    description: "Seed: unassigned → Ack: mark that as ok",
  },
  {
    kind: "sequence", id: "s-05", category: "Stateful Acknowledge Sequences",
    seedMessage: "Show me tomorrow's problem jobs",
    acknowledgeMessage: "Dismiss those flags",
    description: "Seed: problem jobs → Ack: dismiss those flags",
  },

  // ── Off-Domain (must fall through) ────────────────────────────────────────
  { kind: "single", id: "f-01", category: "Off-Domain (must fall through)", message: "Text Maria about her job", expected: "FALLBACK" },
  { kind: "single", id: "f-02", category: "Off-Domain (must fall through)", message: "What's the ETA for team 3?", expected: "FALLBACK" },
  { kind: "single", id: "f-03", category: "Off-Domain (must fall through)", message: "Send invoice to John Smith", expected: "FALLBACK" },
  { kind: "single", id: "f-04", category: "Off-Domain (must fall through)", message: "Call Rohan Gilkes", expected: "FALLBACK" },
  { kind: "single", id: "f-05", category: "Off-Domain (must fall through)", message: "Send a text to Maria", expected: "FALLBACK" },
  { kind: "single", id: "f-06", category: "Off-Domain (must fall through)", message: "Text Team 3", expected: "FALLBACK" },
  { kind: "single", id: "f-07", category: "Off-Domain (must fall through)", message: "Who is Mary Jones?", expected: "FALLBACK" },
  { kind: "single", id: "f-08", category: "Off-Domain (must fall through)", message: "Create an invoice", expected: "FALLBACK" },
  { kind: "single", id: "f-09", category: "Off-Domain (must fall through)", message: "Send a payment link", expected: "FALLBACK" },
  { kind: "single", id: "f-10", category: "Off-Domain (must fall through)", message: "Hire a cleaner", expected: "FALLBACK" },
  { kind: "single", id: "f-11", category: "Off-Domain (must fall through)", message: "What's the weather today?", expected: "FALLBACK" },
  { kind: "single", id: "f-12", category: "Off-Domain (must fall through)", message: "Schedule a meeting", expected: "FALLBACK" },
];

const CATEGORIES = Array.from(new Set(TESTS.map(t => t.category)));
const LS_KEY = "madison-debug-run-history-v2";
const MAX_HISTORY = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSingleOutcome(result: SingleTestResult, test: SingleTestCase): "pass" | "fail" {
  if (result.status === "error") return "fail";
  const rt = result.debug?.responseType;
  if (test.expected === "NEEDS_CONTEXT") return rt === "needs_context" ? "pass" : "fail";
  if (test.expected === "HANDLED") return (rt === "query_result" || rt === "action_result") ? "pass" : "fail";
  // FALLBACK: gate rejected or responseType is fallback
  return (!result.debug?.gate?.gateMatched || rt === "fallback") ? "pass" : "fail";
}

function getSequenceOutcome(result: SequenceTestResult): "pass" | "fail" {
  if (result.status === "error") return "fail";
  if (!result.seed || !result.acknowledge || !result.verification) return "fail";
  if (!result.seed.handled) return "fail";
  const v = result.verification;
  // Use the server-computed verificationPassed flag (Arrange→Act→Assert→Cleanup)
  return v.verificationPassed ? "pass" : "fail";
}

function getTestOutcome(result: TestResult): "pass" | "fail" {
  if (result.kind === "sequence") return getSequenceOutcome(result as SequenceTestResult);
  const test = TESTS.find(t => t.id === result.testId) as SingleTestCase;
  return getSingleOutcome(result as SingleTestResult, test);
}

function buildSinglePipeline(debug: DebugInfo | null | undefined): PipelineStage[] {
  if (!debug) return [];
  const gateOk = debug.gate?.gateMatched ?? false;
  const plannerOk = gateOk && !debug.plannerFailed && debug.plannerType != null;
  const executorOk = plannerOk && (debug.executorInvoked || debug.responseType === "needs_context") && !debug.executorError;
  const responderOk = executorOk && (debug.responseType === "query_result" || debug.responseType === "action_result" || debug.responseType === "needs_context");
  return [
    { name: "Gate", status: gateOk ? "pass" : "fail" },
    { name: "Planner", status: !gateOk ? "skip" : plannerOk ? "pass" : "fail" },
    { name: "Executor", status: !plannerOk ? "skip" : executorOk ? "pass" : "fail" },
    { name: "Responder", status: !executorOk ? "skip" : responderOk ? "pass" : "fail" },
  ];
}

function loadHistory(): RunRecord[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}

function saveHistory(records: RunRecord[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(records.slice(0, MAX_HISTORY))); } catch { /* quota */ }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineViz({ stages }: { stages: PipelineStage[] }) {
  if (!stages.length) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-2">
      {stages.map((s, i) => (
        <div key={s.name} className="flex items-center gap-1">
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${
            s.status === "pass" ? "border-green-300 text-green-700 bg-green-50" :
            s.status === "fail" ? "border-red-300 text-red-700 bg-red-50" :
            "border-gray-200 text-gray-400 bg-gray-50"
          }`}>
            {s.status === "pass" ? <CheckCircle2 className="w-3 h-3" /> :
             s.status === "fail" ? <XCircle className="w-3 h-3" /> :
             <span className="w-3 h-3 inline-block">—</span>}
            {s.name}
          </span>
          {i < stages.length - 1 && <span className="text-gray-300 text-xs">›</span>}
        </div>
      ))}
    </div>
  );
}

function GateDetail({ debug }: { debug: DebugInfo }) {
  const g = debug.gate;
  if (!g) return null;
  return (
    <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs space-y-1.5 font-mono">
      <div className="flex gap-4 flex-wrap">
        <span>Score: <strong>{g.score}</strong></span>
        <span>Threshold: <strong>{g.threshold}</strong></span>
        <span>Matched: <strong className={g.gateMatched ? "text-green-600" : "text-red-600"}>{g.gateMatched ? "yes" : "no"}</strong></span>
        {g.matchedTime && <span className="text-blue-600">time ✓</span>}
      </div>
      {g.matchedConcepts.length > 0 && <div>Concepts: <span className="text-blue-700">{g.matchedConcepts.join(", ")}</span></div>}
      {g.matchedDimensions.length > 0 && <div>Dimensions: <span className="text-purple-700">{g.matchedDimensions.join(", ")}</span></div>}
      {g.matchedActions.length > 0 && <div>Actions: <span className="text-orange-700">{g.matchedActions.join(", ")}</span></div>}
      {g.matchedVerbs.length > 0 && <div>Verbs: <span className="text-teal-700">{g.matchedVerbs.join(", ")}</span></div>}
      {debug.plannerType && <div>Planner: <span className="text-gray-700">{debug.plannerType}</span></div>}
      {debug.responseType && <div>Response type: <span className={debug.responseType === "needs_context" ? "text-amber-600 font-bold" : "text-gray-700"}>{debug.responseType}</span></div>}
      {debug.acknowledgedCount !== undefined && <div>Acknowledged count: <strong>{debug.acknowledgedCount}</strong></div>}
      {debug.plannerError && <div className="text-red-600">Planner error: {debug.plannerError}</div>}
      {debug.executorError && <div className="text-red-600">Executor error: {debug.executorError}</div>}
    </div>
  );
}

function SingleTestRow({ test, result, onRerun }: { test: SingleTestCase; result: SingleTestResult | undefined; onRerun: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const status = result?.status ?? "pending";
  const outcome = result && status !== "pending" && status !== "running" ? getSingleOutcome(result, test) : null;
  const stages = result?.debug ? buildSinglePipeline(result.debug) : [];
  const rt = result?.debug?.responseType;
  const outcomeLabel = rt === "needs_context" ? "NEEDS_CONTEXT" : rt === "query_result" || rt === "action_result" ? "HANDLED" : result?.fallbackReason || rt === "fallback" ? "FALLBACK" : null;

  return (
    <div className={`rounded-xl border p-4 transition-colors ${outcome === "pass" ? "border-green-200 bg-white" : outcome === "fail" ? "border-red-200 bg-red-50/30" : "border-gray-200 bg-white"}`}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-6">
          {status === "pending" && <Clock className="w-5 h-5 text-gray-300" />}
          {status === "running" && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
          {status !== "pending" && status !== "running" && outcome === "pass" && <CheckCircle2 className="w-5 h-5 text-green-500" />}
          {status !== "pending" && status !== "running" && outcome === "fail" && <XCircle className="w-5 h-5 text-red-500" />}
        </div>
        <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0">{test.id}</span>
        <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{test.message}</span>
        {outcomeLabel && (
          <span className={`text-xs font-bold flex-shrink-0 ${outcomeLabel === "HANDLED" ? "text-blue-600" : outcomeLabel === "NEEDS_CONTEXT" ? "text-amber-600" : "text-orange-500"}`}>{outcomeLabel}</span>
        )}
        {result?.durationMs != null && <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right">{result.durationMs}ms</span>}
        <button onClick={() => onRerun(test.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0" title="Rerun"><RotateCcw className="w-4 h-4" /></button>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
      <PipelineViz stages={stages} />
      {expanded && result && (
        <div className="mt-3 space-y-2">
          {result.response && <div className="text-sm text-gray-700 bg-gray-50 rounded p-2 italic">"{result.response}"</div>}
          {result.error && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{result.error}</div>}
          {result.debug && <GateDetail debug={result.debug} />}
        </div>
      )}
    </div>
  );
}

function SequenceTestRow({ test, result, onRerun }: { test: SequenceTestCase; result: SequenceTestResult | undefined; onRerun: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const status = result?.status ?? "pending";
  const outcome = result && status !== "pending" && status !== "running" ? getSequenceOutcome(result) : null;
  const v = result?.verification;

  return (
    <div className={`rounded-xl border p-4 transition-colors ${outcome === "pass" ? "border-green-200 bg-white" : outcome === "fail" ? "border-red-200 bg-red-50/30" : "border-gray-200 bg-white"}`}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-6">
          {status === "pending" && <Clock className="w-5 h-5 text-gray-300" />}
          {status === "running" && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />}
          {status !== "pending" && status !== "running" && outcome === "pass" && <CheckCircle2 className="w-5 h-5 text-green-500" />}
          {status !== "pending" && status !== "running" && outcome === "fail" && <XCircle className="w-5 h-5 text-red-500" />}
        </div>
        <span className="text-xs text-gray-400 font-mono w-10 flex-shrink-0">{test.id}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate text-sm">{test.seedMessage}</div>
          <div className="text-xs text-gray-500 truncate">→ {test.acknowledgeMessage}</div>
        </div>
        {v && (
          <div className="flex gap-2 flex-shrink-0 text-xs">
            <span className={v.executorSucceeded ? "text-green-600 font-medium" : "text-red-500"}>exec:{v.executorSucceeded ? "✓" : "✗"}</span>
            <span className={v.acknowledgedCount > 0 ? "text-green-600 font-medium" : "text-gray-400"}>ack:{v.acknowledgedCount}</span>
            <span className={v.persisted ? "text-green-600 font-medium" : v.acknowledgedCount === 0 ? "text-gray-400" : "text-red-500"}>
              {v.persisted ? "persisted" : v.acknowledgedCount === 0 ? "no items" : "not persisted"}
            </span>
          </div>
        )}
        {result?.durationMs != null && <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right">{result.durationMs}ms</span>}
        <button onClick={() => onRerun(test.id)} className="text-gray-400 hover:text-gray-600 flex-shrink-0" title="Rerun"><RotateCcw className="w-4 h-4" /></button>
        <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
      {result?.seed && result?.acknowledge && (
        <div className="mt-2 flex gap-6 text-xs">
          <div className="flex items-center gap-1"><span className="text-gray-400">Seed:</span><PipelineViz stages={buildSinglePipeline(result.seed.debug ?? undefined)} /></div>
          <div className="flex items-center gap-1"><span className="text-gray-400">Ack:</span><PipelineViz stages={buildSinglePipeline(result.acknowledge.debug ?? undefined)} /></div>
        </div>
      )}
      {expanded && result && (
        <div className="mt-3 space-y-3">
          {result.error && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{result.error}</div>}
          {result.seed && (
            <div className="border rounded-lg p-3 bg-gray-50">
              <div className="text-xs font-semibold text-gray-500 mb-1">Step 1 — Seed Query</div>
              <div className="text-xs text-gray-600">handled: {String(result.seed.handled)}</div>
              {result.seed.response && <div className="text-xs italic text-gray-700 mt-1">"{result.seed.response}"</div>}
              {result.seed.debug && <GateDetail debug={result.seed.debug} />}
            </div>
          )}
          {result.acknowledge && (
            <div className="border rounded-lg p-3 bg-gray-50">
              <div className="text-xs font-semibold text-gray-500 mb-1">Step 2 — Acknowledge</div>
              <div className="text-xs text-gray-600">handled: {String(result.acknowledge.handled)}</div>
              {result.acknowledge.response && <div className="text-xs italic text-gray-700 mt-1">"{result.acknowledge.response}"</div>}
              {result.acknowledge.undoActionId && <div className="text-xs text-green-600 mt-1">undoActionId: {result.acknowledge.undoActionId}</div>}
              {result.acknowledge.debug && <GateDetail debug={result.acknowledge.debug} />}
            </div>
          )}
          {v && (
            <div className="border rounded-lg p-3 bg-blue-50">
              <div className="text-xs font-semibold text-blue-700 mb-1">Verification</div>
              <div className="text-xs space-y-0.5">
                <div>seedItemCount: <strong>{v.seedItemCount}</strong></div>
                <div>executorSucceeded: <strong className={v.executorSucceeded ? "text-green-600" : "text-red-600"}>{String(v.executorSucceeded)}</strong></div>
                <div>acknowledgedCount: <strong>{v.acknowledgedCount}</strong></div>
                <div>persisted: <strong className={v.persisted ? "text-green-600" : v.acknowledgedCount === 0 ? "text-gray-500" : "text-red-600"}>{String(v.persisted)}</strong></div>
                <div>verificationPassed: <strong className={v.verificationPassed ? "text-green-600" : "text-red-600"}>{String(v.verificationPassed)}</strong></div>
                <div>cleanup: <strong className={v.cleanupResult === "success" ? "text-green-600" : v.cleanupResult === "failed" ? "text-red-600" : "text-gray-400"}>{v.cleanupResult}</strong></div>
                {v.needsContext && !v.seedHadItems && <div className="text-amber-600 mt-1">⚠ Seed returned 0 items — nothing to acknowledge. Pipeline is correct; schedule has no readiness issues for this date.</div>}
                {v.needsContext && v.seedHadItems && <div className="text-red-600 mt-1">❌ Seed had {v.seedItemCount} item(s) but ack returned needs_context — context was not saved correctly after seed query.</div>}
                {v.cleanupResult === "failed" && <div className="text-red-600 mt-1">⚠ Cleanup (undo) failed — test data may remain in DB. Check server logs.</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunHistoryPanel({ history, onClose }: { history: RunRecord[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold text-lg flex items-center gap-2"><History className="w-5 h-5" /> Run History</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {history.length === 0 && <p className="text-gray-400 text-sm text-center py-8">No runs yet.</p>}
          {history.map(r => (
            <div key={r.id} className="border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{new Date(r.timestamp).toLocaleString()}</div>
                  <div className="text-xs text-gray-500 font-mono mt-0.5">{r.gitCommit.slice(0, 8)}</div>
                </div>
                <div className="flex gap-3 text-sm">
                  <span className="text-green-600 font-bold">{r.passed} pass</span>
                  <span className="text-red-500 font-bold">{r.failed} fail</span>
                  <span className="text-gray-400">{r.durationMs}ms</span>
                </div>
              </div>
              <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-green-400 rounded-full" style={{ width: `${(r.passed / r.total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? "Login failed");
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <FlaskConical className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900">Madison Debug</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></div>
          <div><Label htmlFor="password">Password</Label><Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MadisonDebugPanel() {
  const agentQuery = trpc.agents.me.useQuery(undefined, { retry: false });
  const debugChatMutation = trpc.aiConcierge.debugChat.useMutation();
  const debugChatSequenceMutation = trpc.aiConcierge.debugChatSequence.useMutation();

  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>(loadHistory);
  const runStartRef = useRef<number>(0);

  const gitCommit = typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "unknown";

  const runSingleTest = useCallback(async (testId: string): Promise<TestResult> => {
    const test = TESTS.find(t => t.id === testId) as SingleTestCase;
    setResults(prev => ({ ...prev, [testId]: { kind: "single", testId, status: "running" } }));
    const t0 = Date.now();
    try {
      const data = await debugChatMutation.mutateAsync({ message: test.message, clearContext: test.clearContext ?? false });
      const result: SingleTestResult = {
        kind: "single", testId, status: "pass",
        durationMs: data.debug?.durationMs ?? (Date.now() - t0),
        response: data.response, fallbackReason: data.fallbackReason, debug: data.debug,
      };
      result.status = getSingleOutcome(result, test);
      setResults(prev => ({ ...prev, [testId]: result }));
      return result;
    } catch (err) {
      const result: SingleTestResult = { kind: "single", testId, status: "error", error: err instanceof Error ? err.message : String(err) };
      setResults(prev => ({ ...prev, [testId]: result }));
      return result;
    }
  }, [debugChatMutation]);

  const runSequenceTest = useCallback(async (testId: string): Promise<TestResult> => {
    const test = TESTS.find(t => t.id === testId) as SequenceTestCase;
    setResults(prev => ({ ...prev, [testId]: { kind: "sequence", testId, status: "running" } }));
    const t0 = Date.now();
    try {
      const data = await debugChatSequenceMutation.mutateAsync({ seedMessage: test.seedMessage, acknowledgeMessage: test.acknowledgeMessage });
      const result: SequenceTestResult = {
        kind: "sequence", testId, status: "pass",
        durationMs: Date.now() - t0,
        seed: data.seed, acknowledge: data.acknowledge, verification: data.verification,
      };
      result.status = getSequenceOutcome(result);
      setResults(prev => ({ ...prev, [testId]: result }));
      return result;
    } catch (err) {
      const result: SequenceTestResult = { kind: "sequence", testId, status: "error", error: err instanceof Error ? err.message : String(err) };
      setResults(prev => ({ ...prev, [testId]: result }));
      return result;
    }
  }, [debugChatSequenceMutation]);

  const runTest = useCallback(async (testId: string): Promise<TestResult> => {
    const test = TESTS.find(t => t.id === testId)!;
    return test.kind === "sequence" ? runSequenceTest(testId) : runSingleTest(testId);
  }, [runSingleTest, runSequenceTest]);

  const runAll = useCallback(async () => {
    setRunning(true);
    runStartRef.current = Date.now();
    const allResults = await Promise.all(TESTS.map(t => runTest(t.id)));
    const durationMs = Date.now() - runStartRef.current;
    const passed = allResults.filter(r => getTestOutcome(r) === "pass").length;
    const failed = allResults.length - passed;
    const record: RunRecord = { id: crypto.randomUUID(), timestamp: Date.now(), gitCommit, total: allResults.length, passed, failed, durationMs };
    setHistory(prev => { const updated = [record, ...prev].slice(0, MAX_HISTORY); saveHistory(updated); return updated; });
    setRunning(false);
    if (failed === 0) toast.success(`All ${passed} tests passed`);
    else toast.error(`${failed} test${failed !== 1 ? "s" : ""} failed`);
  }, [runTest, gitCommit]);

  const exportResults = useCallback(() => {
    const blob = new Blob([JSON.stringify({ timestamp: Date.now(), gitCommit, results }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `madison-debug-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [results, gitCommit]);

  if (agentQuery.isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (!agentQuery.data) return <LoginScreen onLogin={() => agentQuery.refetch()} />;

  const doneResults = Object.values(results).filter(r => r.status !== "pending" && r.status !== "running");
  const totalPassed = doneResults.filter(r => getTestOutcome(r) === "pass").length;
  const totalFailed = doneResults.length - totalPassed;

  return (
    <div className="min-h-screen bg-gray-50">
      {showHistory && <RunHistoryPanel history={history} onClose={() => setShowHistory(false)} />}

      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <FlaskConical className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div className="flex-1">
            <h1 className="font-bold text-gray-900">Madison Regression Suite</h1>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
              <span>{TESTS.length} tests</span>
              <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" />{gitCommit.slice(0, 8)}</span>
              {agentQuery.data && <span>{agentQuery.data.name}</span>}
            </div>
          </div>
          {doneResults.length > 0 && (
            <div className="flex gap-3 text-sm">
              <span className="text-green-600 font-bold">{totalPassed} pass</span>
              <span className="text-red-500 font-bold">{totalFailed} fail</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowHistory(true)}><History className="w-4 h-4 mr-1" /> History</Button>
          <Button variant="outline" size="sm" onClick={exportResults} disabled={doneResults.length === 0}><Download className="w-4 h-4 mr-1" /> Export</Button>
          <Button size="sm" onClick={runAll} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Zap className="w-4 h-4 mr-1" />}
            Run All
          </Button>
        </div>
        {doneResults.length > 0 && (
          <div className="h-1 bg-gray-100">
            <div className="h-full bg-green-400 transition-all duration-300" style={{ width: `${(totalPassed / TESTS.length) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
        {CATEGORIES.map(category => {
          const categoryTests = TESTS.filter(t => t.category === category);
          const categoryDone = categoryTests.filter(t => { const r = results[t.id]; return r && r.status !== "pending" && r.status !== "running"; });
          const categoryPassed = categoryDone.filter(t => { const r = results[t.id]; return r && getTestOutcome(r) === "pass"; });
          const categoryFailed = categoryDone.length - categoryPassed.length;

          return (
            <div key={category}>
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h2 className="font-semibold text-gray-800">{category}</h2>
                <span className="text-xs text-gray-400">{categoryTests.length} tests</span>
                {categoryDone.length > 0 && categoryFailed === 0 && <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">All passed</Badge>}
                {categoryFailed > 0 && <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">{categoryFailed} failed</Badge>}
                {category === "Cold-Session Referential Actions" && (
                  <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />context cleared before each test</span>
                )}
                {category === "Stateful Acknowledge Sequences" && (
                  <span className="text-xs text-blue-600 flex items-center gap-1"><GitBranch className="w-3 h-3" />seed → acknowledge → verify</span>
                )}
              </div>
              <div className="space-y-2">
                {categoryTests.map(test =>
                  test.kind === "sequence" ? (
                    <SequenceTestRow key={test.id} test={test} result={results[test.id] as SequenceTestResult | undefined} onRerun={runTest} />
                  ) : (
                    <SingleTestRow key={test.id} test={test} result={results[test.id] as SingleTestResult | undefined} onRerun={runTest} />
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
