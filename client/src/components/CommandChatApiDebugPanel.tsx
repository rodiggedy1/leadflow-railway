import { useCallback, useId, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { COMMAND_CHAT_DEBUG_ENDPOINTS } from "../lib/commandChatApiDebug";
import type {
  CommandChatApiDebugController,
  CommandChatDebugEndpoint,
} from "../lib/commandChatApiDebug";

type PanelProps = {
  controller: CommandChatApiDebugController;
  waitingFor?: Partial<Record<CommandChatDebugEndpoint, string>>;
};

type WindowStart = {
  controller: CommandChatApiDebugController;
  startedAt: number;
  attempts: number;
  errors: number;
  endpoints: Record<CommandChatDebugEndpoint, { attempts: number; errors: number }>;
};

const endpointLabels: Record<CommandChatDebugEndpoint, string> = {
  "commandCenter.listCommandChatInbox": "Command Chat inbox",
  "opsChat.getLeadSessionStatuses": "Lead statuses",
  "opsChat.getPendingSuperAlerts": "Pending super alerts",
  "opsChat.listActiveThreads": "Active threads",
  "opsChat.listEmailInboxThreads": "Email inbox",
  "voice.listCalls": "Voice call list",
  "commandCenter.listInboundTeamSmsEvents": "Inbound team SMS events",
};

// Never display arbitrary error messages or an unrecognized controller code.
const safeErrorCodes = new Set([
  "PARSE_ERROR", "BAD_REQUEST", "INTERNAL_SERVER_ERROR", "NOT_IMPLEMENTED",
  "BAD_GATEWAY", "SERVICE_UNAVAILABLE", "GATEWAY_TIMEOUT", "UNAUTHORIZED",
  "FORBIDDEN", "NOT_FOUND", "METHOD_NOT_SUPPORTED", "TIMEOUT", "CONFLICT",
  "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "UNPROCESSABLE_CONTENT",
  "UNSUPPORTED_MEDIA_TYPE", "TOO_MANY_REQUESTS", "CLIENT_CLOSED_REQUEST",
]);

const styles: Record<string, CSSProperties> = {
  panel: {
    position: "fixed", bottom: 16, left: 16, zIndex: 10000,
    width: 380, maxWidth: "calc(100vw - 24px)", maxHeight: "70vh",
    overflowY: "auto", boxSizing: "border-box", border: "1px solid #475569",
    borderRadius: 10, background: "#111827", color: "#f1f5f9",
    boxShadow: "0 8px 30px rgba(0,0,0,0.3)",
    fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 12, lineHeight: 1.5,
    textAlign: "left", colorScheme: "dark",
  },
  header: { padding: "10px 12px", borderBottom: "1px solid #334155" },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  heading: { margin: 0, fontSize: 13, fontWeight: 650 },
  badge: {
    display: "inline-block", padding: "1px 5px", border: "1px solid #475569",
    borderRadius: 4, fontSize: 10, fontWeight: 600,
  },
  muted: { color: "#cbd5e1", fontSize: 11, margin: "5px 0 0" },
  warning: { color: "#fde68a", fontSize: 11, margin: "6px 0 0", overflowWrap: "anywhere" },
  disabledList: { margin: "4px 0 0", paddingLeft: 18, color: "#fde68a", fontSize: 11 },
  body: { padding: "10px 12px" },
  buttons: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  button: {
    appearance: "none", border: "1px solid #64748b", borderRadius: 5,
    padding: "4px 7px", background: "#1e293b", color: "#f1f5f9",
    fontFamily: "inherit", fontSize: 11, cursor: "pointer", lineHeight: 1.5,
  },
  section: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #334155" },
  endpoint: { marginTop: 10, paddingTop: 10, borderTop: "1px solid #334155" },
  toggle: { display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" },
  checkbox: { margin: "3px 0 0", flexShrink: 0, accentColor: "#60a5fa" },
  endpointName: {
    display: "block", color: "#cbd5e1", fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    overflowWrap: "anywhere", whiteSpace: "normal",
  },
  metrics: { display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 5, fontSize: 11 },
};

function duration(value: number | null): string {
  return value !== null && Number.isFinite(value) && value >= 0
    ? `${value.toFixed(0)} ms`
    : "Not measured";
}

function attemptDifference(current: number, baseline: number): string {
  const difference = current - baseline;
  return `${difference > 0 ? "+" : ""}${difference}`;
}

function successTime(value: number | null): { label: string; title: string } | null {
  if (value === null || !Number.isFinite(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    label: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    title: date.toISOString(),
  };
}

export default function CommandChatApiDebugPanel({ controller, waitingFor }: PanelProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [expanded, setExpanded] = useState(false);
  const [windowStart, setWindowStart] = useState<WindowStart | null>(null);
  const panelId = useId();
  const bodyId = `${panelId}-body`;
  const headingId = `${panelId}-heading`;

  function startWindow(action: () => void) {
    action();
    // Toggle/start controls synchronously publish fresh counters. The controller
    // owns measurement timing; this UI stores only the counter floor, no queries.
    const next = controller.getSnapshot();
    setWindowStart({
      controller, startedAt: next.measurement.startedAt,
      attempts: next.totals.attempts, errors: next.totals.errors,
      endpoints: Object.fromEntries(COMMAND_CHAT_DEBUG_ENDPOINTS.map(endpoint => [endpoint, {
        attempts: next.endpoints[endpoint].attempts, errors: next.endpoints[endpoint].errors,
      }])) as WindowStart["endpoints"],
    });
  }

  // Eligibility is server-verified by the owner; no hostname or storage inference.
  if (!controller.eligible || !snapshot.eligible) return null;

  const disabled = COMMAND_CHAT_DEBUG_ENDPOINTS.filter(endpoint => !snapshot.enabled[endpoint]);
  const { totals, baseline, measurement } = snapshot;
  const isSingleOff = measurement.kind === "single-off" && disabled.length === 1
    && measurement.endpoint === disabled[0];
  const canRecordBaseline = measurement.kind === "baseline" && disabled.length === 0;
  const observedWindow = windowStart?.controller === controller
    && windowStart.startedAt === measurement.startedAt ? windowStart : null;
  const runAttempts = observedWindow ? totals.attempts - observedWindow.attempts : null;
  const runErrors = observedWindow ? totals.errors - observedWindow.errors : null;
  const startedWithInFlight = "mixedInFlight" in measurement && measurement.mixedInFlight === true;
  const baselineMixed = baseline !== null && "mixedInFlight" in baseline && baseline.mixedInFlight === true;
  // Controller operation timings use a monotonic clock. This read is passive:
  // elapsed time changes only on a controller notification or user interaction.
  const elapsedMs = typeof performance !== "undefined"
    ? performance.now() - measurement.startedAt
    : null;
  const runDuration = elapsedMs !== null && elapsedMs >= 0 ? duration(elapsedMs) : "Unavailable";
  const hasWaitingPrerequisite = COMMAND_CHAT_DEBUG_ENDPOINTS.some(endpoint =>
    snapshot.enabled[endpoint] && Boolean(waitingFor?.[endpoint]));
  const measurementLabel = measurement.kind === "baseline" ? "Baseline run"
    : isSingleOff && measurement.endpoint ? `Single OFF: ${endpointLabels[measurement.endpoint]}`
    : "Custom switch mask";

  return (
    <aside style={styles.panel} aria-labelledby={headingId}>
      <header style={styles.header}>
        <div style={styles.headerRow}>
          <h2 id={headingId} style={styles.heading}>
            API Debug <span style={styles.badge}>Preview ONLY</span>
          </h2>
          <button
            type="button"
            style={styles.button}
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={`${expanded ? "Collapse" : "Expand"} API Debug panel; ${disabled.length} APIs OFF`}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
        <div style={styles.metrics} aria-label="Overall admitted API operation metrics">
          <span><strong>{totals.attempts}</strong> admitted attempts</span>
          <span><strong>{totals.inFlight}</strong> in flight</span>
          <span><strong>{totals.errors}</strong> errors</span>
        </div>
        <p style={disabled.length ? styles.warning : styles.muted}>
          <strong>{disabled.length} of {COMMAND_CHAT_DEBUG_ENDPOINTS.length} APIs OFF</strong>
          {disabled.length === 0 ? " — all reads enabled" : " — reads paused, not refreshing"}
        </p>
        {disabled.length > 0 && (
          <ul style={styles.disabledList} aria-label="Disabled APIs">
            {disabled.map(endpoint => <li key={endpoint} title={endpoint}>{endpointLabels[endpoint]}</li>)}
          </ul>
        )}
      </header>

      <div id={bodyId} hidden={!expanded} style={styles.body}>
        <p style={{ ...styles.warning, marginTop: 0 }}>
          Client-observed end-to-end API operation duration includes transport, batch waiting
          and server processing. This is not SQL timing. Attempts count API operations,
          not HTTP requests; one HTTP batch can contain multiple operations.
        </p>
        <p style={styles.muted}>
          OFF blocks future scoped reads only. Already-admitted work may finish.
          Switches are independent; mutations and unrelated APIs are not controlled here.
        </p>
        <div style={styles.buttons} role="group" aria-label="Manual measurement controls">
          <button type="button" style={styles.button} onClick={() => startWindow(() => controller.resetAll())}
            aria-label="Reset All: enable all seven API reads">Reset All</button>
          <button type="button" style={styles.button} onClick={() => startWindow(() => controller.startBaseline())}
            aria-label="Start baseline: enable all seven API reads and start a measurement">Start baseline</button>
          <button type="button"
            style={{ ...styles.button, opacity: canRecordBaseline ? 1 : 0.5 }}
            disabled={!canRecordBaseline}
            onClick={() => controller.saveBaseline()}
            aria-label="Record baseline: save the current all-enabled measurement summary"
            title={canRecordBaseline ? "Record this normal-use baseline window" : "Start an all-enabled baseline first"}
          >Record baseline</button>
        </div>
        <p style={styles.muted}>
          Controls do not generate synthetic queries or force refetches. Re-enabled reads
          resume their normal schedule. Record a baseline, then use Test only this API OFF.
        </p>

        <section style={styles.section} aria-label="Measurement and baseline comparison">
          <strong>{measurementLabel}</strong>
          <p style={styles.muted}>Run elapsed: {runDuration} (at this render; no timer).</p>
          <p style={styles.muted}>
            {runAttempts !== null && runErrors !== null
              ? `This window: ${runAttempts} admitted attempts; ${runErrors} errors.`
              : "Window counters unavailable: this panel did not observe the measurement start. Start a new window here to compare."}
          </p>
          {measurement.kind !== "baseline" && !isSingleOff && (
            <p style={styles.warning}>
              Not single-off comparison — use Test only this API OFF to disable exactly one read.
            </p>
          )}
          {totals.inFlight > 0 && (
            <p style={styles.warning}>
              {totals.inFlight} operation(s) still in flight. A switch or measurement reset
              does not cancel them; wait for them to settle before interpreting or recording a comparison.
            </p>
          )}
          {startedWithInFlight && (
            <p style={styles.warning}>This window started with in-flight work; it remains a mixed comparison after that work settles.</p>
          )}
          {baseline ? (
            <>
              <p style={styles.muted}>
                Recorded baseline: {baseline.totals.attempts} admitted attempts,
                {" "}{baseline.totals.errors} errors; window {duration(baseline.durationMs)}.
              </p>
              <p style={styles.muted}>
                {runAttempts !== null && runErrors !== null
                  ? `Window − baseline: ${attemptDifference(runAttempts, baseline.totals.attempts)} admitted attempts; ${attemptDifference(runErrors, baseline.totals.errors)} errors.`
                  : "Window − baseline: unavailable until this panel observes a new window start."}
              </p>
              {(baseline.totals.inFlight > 0 || baselineMixed) && (
                <p style={styles.warning}>Recorded baseline had in-flight work; the comparison is mixed/incomplete.</p>
              )}
            </>
          ) : (
            <p style={styles.muted}>No recorded baseline. Use a similar normal-use window before comparing.</p>
          )}
          <p style={styles.muted}>
            Compare similar elapsed windows and interactions. Cold/warm caches and missing
            cohorts limit comparisons. Last duration is one completion, not a statistically
            meaningful average or proof of a slow SQL operation. Metrics and success timestamps
            are observed in memory; only a sanitized baseline summary may survive this tab's reload.
          </p>
          {hasWaitingPrerequisite && (
            <p style={styles.warning}>An enabled API is waiting for prerequisites; not all reads have comparable work.</p>
          )}
        </section>

        <section aria-label="Individual API controls">
          {COMMAND_CHAT_DEBUG_ENDPOINTS.map(endpoint => {
            const enabled = snapshot.enabled[endpoint];
            const metric = snapshot.endpoints[endpoint];
            const recorded = baseline?.endpoints[endpoint];
            const lastSuccess = successTime(metric.lastSuccessAt);
            const prerequisite = enabled ? waitingFor?.[endpoint] : undefined;
            const errorCode = metric.lastErrorCode && safeErrorCodes.has(metric.lastErrorCode)
              ? metric.lastErrorCode : "UNKNOWN_CODE";
            const httpStatus = metric.lastHttpStatus !== null
              && Number.isInteger(metric.lastHttpStatus)
              && metric.lastHttpStatus >= 100 && metric.lastHttpStatus <= 599
              ? metric.lastHttpStatus : null;
            const checkboxId = `${panelId}-${endpoint}`;
            return (
              <div key={endpoint} style={styles.endpoint}>
                <label htmlFor={checkboxId} style={styles.toggle}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    style={styles.checkbox}
                    checked={enabled}
                    onChange={event => {
                      const checked = event.currentTarget.checked;
                      startWindow(() => controller.setEnabled(endpoint, checked));
                    }}
                    aria-label={`${endpoint}: enable API reads`}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <strong>{endpointLabels[endpoint]}</strong>{" "}
                    <span style={styles.badge}>{enabled ? "ON" : "OFF"}</span>
                    <span style={styles.endpointName} title={endpoint}>{endpoint}</span>
                  </span>
                </label>
                <div style={styles.metrics} aria-label={`${endpoint} metrics`}>
                  <span>Requests: <strong>{metric.attempts}</strong></span>
                  <span>In flight: <strong>{metric.inFlight}</strong></span>
                  <span>Errors: <strong>{metric.errors}</strong></span>
                  <span>Last duration: <strong>{duration(metric.lastDurationMs)}</strong></span>
                </div>
                {!enabled && (
                  <p style={styles.warning}>
                    OFF — Last known data / not refreshing.
                    {metric.inFlight > 0 ? " Existing request may still finish." : ""}
                  </p>
                )}
                {prerequisite && <p style={styles.warning}>ON — Waiting for {prerequisite}.</p>}
                <p style={styles.muted}>
                  {lastSuccess ? (
                    <>Last success: <time dateTime={lastSuccess.title} title={lastSuccess.title}>{lastSuccess.label}</time>
                      {" "}(observed this session; not a cache-presence check).</>
                  ) : (
                    <>No observed success; cache availability unknown. This does not mean an empty result.</>
                  )}
                </p>
                {metric.lastStatus === "error" && (
                  <p style={styles.warning}>
                    Last completion error: <code>{errorCode}</code>
                    {httpStatus !== null ? ` / HTTP ${httpStatus}` : " / HTTP status unavailable"}.
                  </p>
                )}
                {metric.lastStatus === "suppressed" && (
                  <p style={styles.muted}>Last attempt deliberately suppressed — not a server error.</p>
                )}
                {metric.suppressed > 0 && (
                  <p style={styles.muted}>Suppressed: {metric.suppressed} (excluded from requests and errors).</p>
                )}
                {recorded && (
                  <p style={styles.muted}>
                    Baseline: {recorded.attempts} requests; last duration {duration(recorded.lastDurationMs)};
                    {" "}{recorded.errors} errors. Δ window requests: {observedWindow
                      ? attemptDifference(metric.attempts - observedWindow.endpoints[endpoint].attempts, recorded.attempts)
                      : "Unavailable"}.
                  </p>
                )}
                <button
                  type="button"
                  style={{ ...styles.button, marginTop: 6 }}
                  title={`Set ${endpoint} OFF and the other six reads ON; no forced queries`}
                  aria-label={`Test only this API OFF: ${endpoint}; enable the other six reads`}
                  onClick={() => startWindow(() => controller.testOnly(endpoint))}
                >Test only this API OFF</button>
              </div>
            );
          })}
        </section>
      </div>
    </aside>
  );
}
