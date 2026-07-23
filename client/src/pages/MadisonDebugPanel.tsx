/**
 * MadisonDebugPanel — Madison's permanent regression dashboard.
 *
 * Calls trpc.aiConcierge.debugChat() — the exact same orchestration pipeline
 * as the production chat endpoint, with full diagnostics exposed.
 *
 * Features:
 *   - Data-driven test matrix (add new cases by editing TESTS array)
 *   - Parallel execution of all tests
 *   - Pipeline visualization: Gate → Planner → Executor → Responder
 *   - Pass/fail color coding
 *   - Per-test rerun
 *   - Run history in localStorage (timestamp, commit, pass/fail counts)
 *   - JSON export of results
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
  Play,
  RotateCcw,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  FlaskConical,
  History,
  Zap,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpectedOutcome = "HANDLED" | "FALLBACK";

interface TestCase {
  id: string;
  category: string;
  message: string;
  expected: ExpectedOutcome;
  description?: string;
}

interface PipelineStage {
  name: string;
  status: "pass" | "fail" | "skip" | "pending";
  detail?: string;
}

interface TestResult {
  testId: string;
  status: "pass" | "fail" | "error" | "running" | "pending";
  durationMs?: number;
  response?: string | null;
  fallbackReason?: string | null;
  pipeline?: PipelineStage[];
  debug?: {
    gate: {
      score: number;
      threshold: number;
      gateMatched: boolean;
      matchedConcepts: string[];
      matchedDimensions: string[];
      matchedActions: string[];
      matchedVerbs: string[];
      matchedTime: boolean;
    };
    plannerType: "query" | "action" | null;
    plannerFailed: boolean;
    plannerError?: string;
    executorInvoked: boolean;
    executorError?: string;
    responseType: "query_result" | "action_result" | "fallback" | null;
    durationMs: number;
  } | null;
  error?: string;
}

interface RunRecord {
  id: string;
  timestamp: number;
  gitCommit: string;
  totalTests: number;
  passed: number;
  failed: number;
  durationMs: number;
  results: TestResult[];
}

// ─── Test Matrix ──────────────────────────────────────────────────────────────
// Add new regression cases here. The panel renders from this array.

const TESTS: TestCase[] = [
  // ── Readiness Queries — should be HANDLED ─────────────────────────────────
  {
    id: "q-01",
    category: "Readiness Queries",
    message: "What needs attention tomorrow?",
    expected: "HANDLED",
    description: "Core readiness query — canonical test case",
  },
  {
    id: "q-02",
    category: "Readiness Queries",
    message: "Are we ready for today?",
    expected: "HANDLED",
    description: "Today scope",
  },
  {
    id: "q-03",
    category: "Readiness Queries",
    message: "Which jobs have no cleaner this week?",
    expected: "HANDLED",
    description: "Unassigned dimension + week scope",
  },
  {
    id: "q-04",
    category: "Readiness Queries",
    message: "Show me unconfirmed jobs tomorrow morning",
    expected: "HANDLED",
    description: "Confirmation dimension + morning filter",
  },
  {
    id: "q-05",
    category: "Readiness Queries",
    message: "Any payment issues tomorrow afternoon?",
    expected: "HANDLED",
    description: "Payment dimension + afternoon filter",
  },
  {
    id: "q-06",
    category: "Readiness Queries",
    message: "Which jobs are at risk tomorrow?",
    expected: "HANDLED",
    description: "Risk/attention filter",
  },
  {
    id: "q-07",
    category: "Readiness Queries",
    message: "What's the 9 AM job situation today?",
    expected: "HANDLED",
    description: "Exact time filter",
  },
  {
    id: "q-08",
    category: "Readiness Queries",
    message: "Any access instruction problems tomorrow?",
    expected: "HANDLED",
    description: "Access dimension",
  },
  {
    id: "q-09",
    category: "Readiness Queries",
    message: "Show me double-booked jobs this week",
    expected: "HANDLED",
    description: "Double-booking dimension",
  },
  {
    id: "q-10",
    category: "Readiness Queries",
    message: "How are we looking tomorrow?",
    expected: "HANDLED",
    description: "Conversational readiness query",
  },
  {
    id: "q-11",
    category: "Readiness Queries",
    message: "Anything wrong with tomorrow's schedule?",
    expected: "HANDLED",
    description: "Schedule issues",
  },
  {
    id: "q-12",
    category: "Readiness Queries",
    message: "Do all jobs have teams today?",
    expected: "HANDLED",
    description: "Team assignment check",
  },
  {
    id: "q-13",
    category: "Readiness Queries",
    message: "Who still needs confirmation tomorrow?",
    expected: "HANDLED",
    description: "Confirmation check",
  },
  {
    id: "q-14",
    category: "Readiness Queries",
    message: "Are cards good for tomorrow?",
    expected: "HANDLED",
    description: "Payment/card check",
  },
  {
    id: "q-15",
    category: "Readiness Queries",
    message: "Any entry notes missing?",
    expected: "HANDLED",
    description: "Access/entry notes",
  },
  {
    id: "q-16",
    category: "Readiness Queries",
    message: "What conflicts do we have this week?",
    expected: "HANDLED",
    description: "Conflicts/double-bookings this week",
  },
  {
    id: "q-17",
    category: "Readiness Queries",
    message: "Show me tomorrow's problems.",
    expected: "HANDLED",
    description: "Problems/issues query",
  },
  {
    id: "q-18",
    category: "Readiness Queries",
    message: "Which jobs aren't confirmed?",
    expected: "HANDLED",
    description: "Unconfirmed jobs",
  },
  {
    id: "q-19",
    category: "Readiness Queries",
    message: "Which jobs have payment issues?",
    expected: "HANDLED",
    description: "Payment issues",
  },
  {
    id: "q-20",
    category: "Readiness Queries",
    message: "Which jobs have no cleaner assigned?",
    expected: "HANDLED",
    description: "Unassigned jobs",
  },
  {
    id: "q-21",
    category: "Readiness Queries",
    message: "Show me only the 9 AM jobs.",
    expected: "HANDLED",
    description: "Exact time slot filter",
  },
  {
    id: "q-22",
    category: "Readiness Queries",
    message: "Which afternoon jobs are at risk?",
    expected: "HANDLED",
    description: "Afternoon + risk filter",
  },
  {
    id: "q-23",
    category: "Readiness Queries",
    message: "Are there any access issues tomorrow?",
    expected: "HANDLED",
    description: "Access issues",
  },
  {
    id: "q-24",
    category: "Readiness Queries",
    message: "Are there any double bookings tomorrow?",
    expected: "HANDLED",
    description: "Double bookings",
  },
  {
    id: "q-25",
    category: "Readiness Queries",
    message: "Any schedule conflicts tomorrow?",
    expected: "HANDLED",
    description: "Schedule conflicts",
  },
  {
    id: "q-26",
    category: "Readiness Queries",
    message: "Which jobs have no cleaner tomorrow?",
    expected: "HANDLED",
    description: "Unassigned tomorrow",
  },

  // ── Acknowledge Actions — should be HANDLED ───────────────────────────────
  {
    id: "a-01",
    category: "Acknowledge Actions",
    message: "Acknowledge those issues",
    expected: "HANDLED",
    description: "Acknowledge action — plural",
  },
  {
    id: "a-02",
    category: "Acknowledge Actions",
    message: "Mark that as ok",
    expected: "HANDLED",
    description: "Mark as OK action",
  },
  {
    id: "a-03",
    category: "Acknowledge Actions",
    message: "Dismiss those flags",
    expected: "HANDLED",
    description: "Dismiss flags action",
  },
  {
    id: "a-04",
    category: "Acknowledge Actions",
    message: "That's fine",
    expected: "HANDLED",
    description: "Conversational acknowledgement",
  },
  {
    id: "a-05",
    category: "Acknowledge Actions",
    message: "Mark them as handled",
    expected: "HANDLED",
    description: "Mark as handled",
  },

  // ── Off-Domain — should be FALLBACK ───────────────────────────────────────
  {
    id: "f-01",
    category: "Off-Domain (must fall through)",
    message: "Text Maria about her job",
    expected: "FALLBACK",
    description: "SMS action — not readiness",
  },
  {
    id: "f-02",
    category: "Off-Domain (must fall through)",
    message: "What's the ETA for team 3?",
    expected: "FALLBACK",
    description: "ETA query — not readiness",
  },
  {
    id: "f-03",
    category: "Off-Domain (must fall through)",
    message: "Send invoice to John Smith",
    expected: "FALLBACK",
    description: "Invoice action — not readiness",
  },
  {
    id: "f-04",
    category: "Off-Domain (must fall through)",
    message: "Call Rohan Gilkes",
    expected: "FALLBACK",
    description: "Call action — not readiness",
  },
  {
    id: "f-05",
    category: "Off-Domain (must fall through)",
    message: "Send a text to Maria",
    expected: "FALLBACK",
    description: "SMS action — not readiness",
  },
  {
    id: "f-06",
    category: "Off-Domain (must fall through)",
    message: "Text Team 3",
    expected: "FALLBACK",
    description: "Text team — not readiness",
  },
  {
    id: "f-07",
    category: "Off-Domain (must fall through)",
    message: "Who is Mary Jones?",
    expected: "FALLBACK",
    description: "Person lookup — not readiness",
  },
  {
    id: "f-08",
    category: "Off-Domain (must fall through)",
    message: "Create an invoice",
    expected: "FALLBACK",
    description: "Invoice creation — not readiness",
  },
  {
    id: "f-09",
    category: "Off-Domain (must fall through)",
    message: "Send a payment link",
    expected: "FALLBACK",
    description: "Payment link — not readiness",
  },
  {
    id: "f-10",
    category: "Off-Domain (must fall through)",
    message: "Hire a cleaner",
    expected: "FALLBACK",
    description: "Hiring — not readiness",
  },
  {
    id: "f-11",
    category: "Off-Domain (must fall through)",
    message: "What's today's revenue?",
    expected: "FALLBACK",
    description: "Revenue query — not readiness",
  },
  {
    id: "f-12",
    category: "Off-Domain (must fall through)",
    message: "Show yesterday's leads",
    expected: "FALLBACK",
    description: "Leads query — not readiness",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "madison_debug_run_history";
const MAX_HISTORY = 20;

function loadHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: RunRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

function buildPipeline(result: TestResult): PipelineStage[] {
  const d = result.debug;
  if (!d) return [];

  const stages: PipelineStage[] = [];

  // Gate
  stages.push({
    name: "Gate",
    status: d.gate.gateMatched ? "pass" : "fail",
    detail: d.gate.gateMatched
      ? `score=${d.gate.score} ≥ threshold=${d.gate.threshold}`
      : `score=${d.gate.score} < threshold=${d.gate.threshold}`,
  });

  if (!d.gate.gateMatched) {
    // Gate rejected — remaining stages skipped
    stages.push({ name: "Planner", status: "skip" });
    stages.push({ name: "Executor", status: "skip" });
    stages.push({ name: "Responder", status: "skip" });
    return stages;
  }

  // Planner
  stages.push({
    name: "Planner",
    status: d.plannerFailed ? "fail" : "pass",
    detail: d.plannerFailed
      ? d.plannerError ?? "failed"
      : `type=${d.plannerType ?? "unknown"}`,
  });

  if (d.plannerFailed) {
    stages.push({ name: "Executor", status: "skip" });
    stages.push({ name: "Responder", status: "skip" });
    return stages;
  }

  // Executor
  stages.push({
    name: "Executor",
    status: d.executorInvoked
      ? d.executorError ? "fail" : "pass"
      : "skip",
    detail: d.executorError ?? (d.executorInvoked ? "ok" : "not invoked"),
  });

  // Responder / Projection
  stages.push({
    name: "Responder",
    status: d.responseType === "fallback" ? "fail" : "pass",
    detail: d.responseType ?? "unknown",
  });

  return stages;
}

function getTestOutcome(result: TestResult, test: TestCase): "pass" | "fail" {
  if (result.status === "error") return "fail";
  const actualHandled = result.debug
    ? result.debug.responseType !== "fallback" && result.debug.gate.gateMatched
    : (result.response != null && result.response !== "");
  const expectedHandled = test.expected === "HANDLED";
  return actualHandled === expectedHandled ? "pass" : "fail";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineViz({ stages }: { stages: PipelineStage[] }) {
  if (!stages.length) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-2">
      {stages.map((stage, i) => (
        <div key={stage.name} className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
              stage.status === "pass"
                ? "bg-green-50 text-green-700 border border-green-200"
                : stage.status === "fail"
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-gray-50 text-gray-400 border border-gray-200"
            }`}
            title={stage.detail}
          >
            {stage.status === "pass" && <CheckCircle2 className="w-3 h-3" />}
            {stage.status === "fail" && <XCircle className="w-3 h-3" />}
            {stage.status === "skip" && <span className="w-3 h-3 text-center leading-3">—</span>}
            {stage.name}
          </div>
          {i < stages.length - 1 && (
            <span className="text-gray-300 text-xs">›</span>
          )}
        </div>
      ))}
    </div>
  );
}

function TestRow({
  test,
  result,
  onRerun,
}: {
  test: TestCase;
  result: TestResult;
  onRerun: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const outcome = result.status === "pending" || result.status === "running"
    ? null
    : getTestOutcome(result, test);
  const pipeline = result.debug ? buildPipeline(result) : [];

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${
        outcome === "pass"
          ? "border-green-200 bg-green-50/30"
          : outcome === "fail"
          ? "border-red-200 bg-red-50/30"
          : "border-gray-200 bg-white"
      }`}
    >
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Status icon */}
        <div className="flex-shrink-0 w-5">
          {result.status === "running" && (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          )}
          {result.status === "pending" && (
            <Clock className="w-4 h-4 text-gray-300" />
          )}
          {outcome === "pass" && (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          )}
          {outcome === "fail" && (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
        </div>

        {/* Test ID */}
        <span className="text-xs font-mono text-gray-400 w-10 flex-shrink-0">
          {test.id}
        </span>

        {/* Message */}
        <span className="flex-1 text-sm font-medium text-gray-800 truncate">
          {test.message}
        </span>

        {/* Expected badge */}
        <Badge
          variant="outline"
          className={`text-xs flex-shrink-0 ${
            test.expected === "HANDLED"
              ? "border-blue-200 text-blue-600"
              : "border-amber-200 text-amber-600"
          }`}
        >
          {test.expected}
        </Badge>

        {/* Duration */}
        {result.durationMs != null && (
          <span className="text-xs text-gray-400 flex-shrink-0 w-16 text-right">
            {result.durationMs}ms
          </span>
        )}

        {/* Rerun button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={() => onRerun(test.id)}
          disabled={result.status === "running"}
          title="Rerun this test"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>

        {/* Expand toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={() => setExpanded(e => !e)}
          disabled={result.status === "pending" || result.status === "running"}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>

      {/* Pipeline visualization (always visible when result available) */}
      {pipeline.length > 0 && (
        <div className="px-4 pb-2">
          <PipelineViz stages={pipeline} />
        </div>
      )}

      {/* Expanded detail */}
      {expanded && result.status !== "pending" && result.status !== "running" && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* Description */}
          {test.description && (
            <p className="text-xs text-gray-500">{test.description}</p>
          )}

          {/* Response */}
          {result.response && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Response</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded p-2 font-mono whitespace-pre-wrap">
                {result.response}
              </p>
            </div>
          )}

          {/* Fallback reason */}
          {result.fallbackReason && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Fallback Reason</p>
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                {result.fallbackReason}
              </Badge>
            </div>
          )}

          {/* Error */}
          {result.error && (
            <div>
              <p className="text-xs font-semibold text-red-500 mb-1">Error</p>
              <p className="text-xs text-red-600 bg-red-50 rounded p-2 font-mono">
                {result.error}
              </p>
            </div>
          )}

          {/* Gate diagnostics */}
          {result.debug?.gate && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1">Gate Diagnostics</p>
              <div className="text-xs font-mono bg-gray-50 rounded p-2 space-y-0.5">
                <div>score: <span className="text-blue-600">{result.debug.gate.score}</span> / threshold: <span className="text-blue-600">{result.debug.gate.threshold}</span></div>
                {result.debug.gate.matchedConcepts.length > 0 && (
                  <div>concepts: <span className="text-green-600">{result.debug.gate.matchedConcepts.join(", ")}</span></div>
                )}
                {result.debug.gate.matchedDimensions.length > 0 && (
                  <div>dimensions: <span className="text-green-600">{result.debug.gate.matchedDimensions.join(", ")}</span></div>
                )}
                {result.debug.gate.matchedActions.length > 0 && (
                  <div>actions: <span className="text-green-600">{result.debug.gate.matchedActions.join(", ")}</span></div>
                )}
                {result.debug.gate.matchedVerbs.length > 0 && (
                  <div>verbs: <span className="text-green-600">{result.debug.gate.matchedVerbs.join(", ")}</span></div>
                )}
                {result.debug.gate.matchedTime && (
                  <div>time: <span className="text-green-600">matched</span></div>
                )}
              </div>
            </div>
          )}

          {/* Full debug JSON */}
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Raw debug JSON
            </summary>
            <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-auto max-h-48 text-gray-600">
              {JSON.stringify(result.debug, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function RunHistoryPanel({ history, onClose }: { history: RunRecord[]; onClose: () => void }) {
  if (!history.length) {
    return (
      <div className="hj-card p-6 text-center">
        <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-400">No run history yet.</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={onClose}>Close</Button>
      </div>
    );
  }

  return (
    <div className="hj-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-sm text-gray-800">Run History</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {history.map((run) => {
          const allPassed = run.failed === 0;
          const pct = Math.round((run.passed / run.totalTests) * 100);
          return (
            <div key={run.id} className="px-4 py-3 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${allPassed ? "bg-green-500" : "bg-red-500"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-500">{run.gitCommit}</span>
                  <span className={`text-xs font-semibold ${allPassed ? "text-green-600" : "text-red-600"}`}>
                    {run.passed}/{run.totalTests} ({pct}%)
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {new Date(run.timestamp).toLocaleString()} · {run.durationMs}ms
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `madison-run-${run.id}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="w-3 h-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Admin Login ──────────────────────────────────────────────────────────────

function AdminLoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const utils = trpc.useUtils();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setIsPending(true);
    try {
      const res = await fetch("/api/agents/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "Login failed");
        return;
      }
      if (!data.agent.isAdmin) {
        toast.error("Admin access required for this panel.");
        return;
      }
      toast.success(`Welcome, ${data.agent.name}!`);
      utils.agents.me.invalidate().then(() => onSuccess());
    } catch {
      toast.error("Login failed. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="hj-theme min-h-screen flex items-center justify-center bg-gray-50">
      <div className="hj-card p-8 max-w-sm w-full mx-4">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: "var(--hj-green)", color: "#000" }}>
            <Lock className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Madison Debug Panel</h1>
          <p className="text-sm text-gray-500 mt-1">Admin access required</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="debug-email">Email</Label>
            <Input
              id="debug-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="debug-password">Password</Label>
            <Input
              id="debug-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={isPending}
            />
          </div>
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Sign In
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function MadisonDebugPanel() {
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, staleTime: 5 * 60 * 1000 });
  const [authChecked, setAuthChecked] = useState(false);
  const [results, setResults] = useState<Record<string, TestResult>>(() =>
    Object.fromEntries(TESTS.map(t => [t.id, { testId: t.id, status: "pending" }]))
  );
  const [isRunning, setIsRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RunRecord[]>(() => loadHistory());
  const runStartRef = useRef<number>(0);

  const debugChatMutation = trpc.aiConcierge.debugChat.useMutation();

  // Auth check
  const hasSession = !meQuery.isLoading && !!meQuery.data;
  if (!authChecked && !meQuery.isLoading) setAuthChecked(true);

  const gitCommit = typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "unknown";

  // ── Run a single test ──────────────────────────────────────────────────────
  const runTest = useCallback(async (testId: string): Promise<TestResult> => {
    const test = TESTS.find(t => t.id === testId)!;
    setResults(prev => ({
      ...prev,
      [testId]: { testId, status: "running" },
    }));

    try {
      const data = await debugChatMutation.mutateAsync({ message: test.message });
      const result: TestResult = {
        testId,
        status: "done" as any, // will be resolved to pass/fail by getTestOutcome
        durationMs: data.debug?.durationMs,
        response: data.response,
        fallbackReason: data.fallbackReason,
        debug: data.debug,
      };
      // Determine pass/fail
      const outcome = getTestOutcome(result, test);
      result.status = outcome === "pass" ? "pass" : "fail";
      setResults(prev => ({ ...prev, [testId]: result }));
      return result;
    } catch (err) {
      const result: TestResult = {
        testId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
      setResults(prev => ({ ...prev, [testId]: result }));
      return result;
    }
  }, [debugChatMutation]);

  // ── Run all tests in parallel ──────────────────────────────────────────────
  const runAll = useCallback(async () => {
    setIsRunning(true);
    runStartRef.current = Date.now();

    // Reset all to pending
    setResults(Object.fromEntries(TESTS.map(t => [t.id, { testId: t.id, status: "pending" }])));

    // Run all in parallel
    const allResults = await Promise.all(TESTS.map(t => runTest(t.id)));

    const durationMs = Date.now() - runStartRef.current;
    const passed = allResults.filter(r => r.status === "pass").length;
    const failed = allResults.length - passed;

    // Save to history
    const record: RunRecord = {
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      gitCommit,
      totalTests: TESTS.length,
      passed,
      failed,
      durationMs,
      results: allResults,
    };
    const newHistory = [record, ...history].slice(0, MAX_HISTORY);
    setHistory(newHistory);
    saveHistory(newHistory);

    setIsRunning(false);

    if (failed === 0) {
      toast.success(`All ${passed} tests passed in ${durationMs}ms`);
    } else {
      toast.error(`${failed} test${failed !== 1 ? "s" : ""} failed (${passed}/${TESTS.length} passed)`);
    }
  }, [runTest, history, gitCommit]);

  // ── Export results ─────────────────────────────────────────────────────────
  const exportResults = useCallback(() => {
    const data = {
      timestamp: new Date().toISOString(),
      gitCommit,
      tests: TESTS.map(t => ({
        ...t,
        result: results[t.id],
        outcome: results[t.id]?.status === "pending" || results[t.id]?.status === "running"
          ? "pending"
          : getTestOutcome(results[t.id], t),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `madison-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results, gitCommit]);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (meQuery.isLoading) {
    return (
      <div className="hj-theme min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!hasSession) {
    return <AdminLoginScreen onSuccess={() => meQuery.refetch()} />;
  }

  // ── Compute summary ────────────────────────────────────────────────────────
  const allDone = Object.values(results).every(r => r.status !== "pending" && r.status !== "running");
  const passCount = Object.entries(results).filter(([id, r]) => {
    const test = TESTS.find(t => t.id === id)!;
    return r.status !== "pending" && r.status !== "running" && getTestOutcome(r, test) === "pass";
  }).length;
  const failCount = Object.entries(results).filter(([id, r]) => {
    const test = TESTS.find(t => t.id === id)!;
    return r.status !== "pending" && r.status !== "running" && getTestOutcome(r, test) === "fail";
  }).length;

  // Group tests by category
  const categories = Array.from(new Set(TESTS.map(t => t.category)));

  return (
    <div className="hj-theme min-h-screen bg-gray-50">
      {/* Header */}
      <div className="hj-header sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-gray-600" />
          <div className="flex-1">
            <h1 className="text-base font-bold text-gray-900">Madison Regression Suite</h1>
            <p className="text-xs text-gray-400">
              {TESTS.length} tests · commit <span className="font-mono">{gitCommit}</span>
            </p>
          </div>

          {/* Summary badges */}
          {allDone && (
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {passCount} passed
              </Badge>
              {failCount > 0 && (
                <Badge className="bg-red-100 text-red-700 border-red-200">
                  <XCircle className="w-3 h-3 mr-1" />
                  {failCount} failed
                </Badge>
              )}
            </div>
          )}

          {/* Actions */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(h => !h)}
            className="gap-1.5"
          >
            <History className="w-4 h-4" />
            History
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={exportResults}
            disabled={!allDone}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button
            onClick={runAll}
            disabled={isRunning}
            className="gap-1.5"
            style={{ backgroundColor: "var(--hj-green)", color: "#000" }}
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {isRunning ? "Running…" : "Run All"}
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* History panel */}
        {showHistory && (
          <RunHistoryPanel history={history} onClose={() => setShowHistory(false)} />
        )}

        {/* Test categories */}
        {categories.map(category => {
          const categoryTests = TESTS.filter(t => t.category === category);
          const catPassed = categoryTests.filter(t => {
            const r = results[t.id];
            return r.status !== "pending" && r.status !== "running" && getTestOutcome(r, t) === "pass";
          }).length;
          const catFailed = categoryTests.filter(t => {
            const r = results[t.id];
            return r.status !== "pending" && r.status !== "running" && getTestOutcome(r, t) === "fail";
          }).length;
          const catDone = categoryTests.every(t => {
            const r = results[t.id];
            return r.status !== "pending" && r.status !== "running";
          });

          return (
            <div key={category}>
              {/* Category header */}
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-sm font-semibold text-gray-700">{category}</h2>
                <span className="text-xs text-gray-400">{categoryTests.length} tests</span>
                {catDone && catFailed === 0 && (
                  <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                    All passed
                  </Badge>
                )}
                {catDone && catFailed > 0 && (
                  <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
                    {catFailed} failed
                  </Badge>
                )}
                {!catDone && catPassed > 0 && (
                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                    {catPassed}/{categoryTests.length}
                  </Badge>
                )}
              </div>

              {/* Test rows */}
              <div className="space-y-2">
                {categoryTests.map(test => (
                  <TestRow
                    key={test.id}
                    test={test}
                    result={results[test.id]}
                    onRerun={id => runTest(id)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {!allDone && !isRunning && (
          <div className="text-center py-12">
            <FlaskConical className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">
              Click <strong>Run All</strong> to execute the full regression suite.
            </p>
            <p className="text-xs text-gray-300 mt-1">
              All {TESTS.length} tests run in parallel against the live pipeline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
