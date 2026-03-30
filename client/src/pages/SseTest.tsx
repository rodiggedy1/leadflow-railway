/**
 * SseTest.tsx — Proof-of-concept SSE test page.
 *
 * Visit /sse-test to run the test. The page:
 *   1. Opens an SSE connection to /api/sse-test
 *   2. Displays each incoming event in real time
 *   3. Shows a clear PASS / FAIL verdict based on whether events arrive
 *   4. Has a "Fire Trigger" button that calls POST /api/sse-test/trigger
 *      to simulate a server-push event (e.g. new lead arriving)
 *
 * This page is intentionally standalone — no auth, no tRPC — so we can
 * isolate the SSE proxy behaviour cleanly.
 */

import { useEffect, useRef, useState } from "react";

type LogEntry = {
  id: number;
  ts: string;
  event: string;
  data: string;
  ok: boolean;
};

type TestStatus = "idle" | "connecting" | "connected" | "failed" | "done";

export default function SseTest() {
  const [status, setStatus] = useState<TestStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [pingCount, setPingCount] = useState(0);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  function addLog(event: string, data: string, ok = true) {
    const entry: LogEntry = {
      id: logIdRef.current++,
      ts: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      event,
      data,
      ok,
    };
    setLog((prev) => [...prev, entry]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function startTest() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setLog([]);
    setPingCount(0);
    setTriggerResult(null);
    setStatus("connecting");
    addLog("system", "Opening SSE connection to /api/sse-test…");

    const es = new EventSource("/api/sse-test");
    esRef.current = es;

    es.addEventListener("connected", (e: MessageEvent) => {
      setStatus("connected");
      addLog("connected ✅", e.data);
    });

    es.addEventListener("ping", (e: MessageEvent) => {
      setPingCount((n) => n + 1);
      addLog("ping ✅", e.data);
    });

    es.addEventListener("trigger", (e: MessageEvent) => {
      addLog("trigger 🚀", e.data);
    });

    es.addEventListener("done", (e: MessageEvent) => {
      setStatus("done");
      addLog("done 🎉", e.data);
      es.close();
    });

    es.onerror = () => {
      setStatus("failed");
      addLog("error ❌", "SSE connection error — proxy may be buffering or blocking the stream.", false);
      es.close();
    };
  }

  async function fireTrigger() {
    setTriggerResult("Firing…");
    try {
      const res = await fetch("/api/sse-test/trigger", { method: "POST" });
      const json = await res.json();
      setTriggerResult(`✅ Server notified ${json.clientsNotified} client(s)`);
    } catch {
      setTriggerResult("❌ Trigger request failed");
    }
  }

  // Clean up on unmount
  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  const verdict =
    status === "connected" || status === "done" ? "PASS" :
    status === "failed" ? "FAIL" : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-mono p-8">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">SSE Proxy Test</h1>
          <p className="text-slate-400 text-sm mt-1">
            Verifies that the Manus hosting proxy passes Server-Sent Events through without buffering.
            Deploy this to production and run the test there — local dev always passes.
          </p>
        </div>

        {/* Status bar */}
        <div className={`rounded-xl px-5 py-4 border flex items-center justify-between ${
          verdict === "PASS" ? "bg-emerald-950 border-emerald-700" :
          verdict === "FAIL" ? "bg-red-950 border-red-700" :
          "bg-slate-900 border-slate-700"
        }`}>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-widest mb-0.5">Status</p>
            <p className={`text-lg font-bold ${
              status === "connecting" ? "text-amber-400" :
              status === "connected" ? "text-emerald-400" :
              status === "failed" ? "text-red-400" :
              status === "done" ? "text-emerald-400" :
              "text-slate-400"
            }`}>
              {status === "idle" && "Not started"}
              {status === "connecting" && "Connecting…"}
              {status === "connected" && `Connected — ${pingCount} ping${pingCount !== 1 ? "s" : ""} received`}
              {status === "failed" && "Connection failed — SSE may be blocked by proxy"}
              {status === "done" && `Complete — ${pingCount} pings received successfully`}
            </p>
          </div>
          {verdict && (
            <div className={`text-3xl font-black ${verdict === "PASS" ? "text-emerald-400" : "text-red-400"}`}>
              {verdict}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={startTest}
            disabled={status === "connecting" || status === "connected"}
            className="px-5 py-2.5 rounded-lg bg-white text-slate-900 font-bold text-sm hover:bg-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "idle" ? "▶ Start Test" : status === "done" || status === "failed" ? "↺ Restart Test" : "⏳ Running…"}
          </button>

          <button
            onClick={fireTrigger}
            disabled={status !== "connected" && status !== "done"}
            className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🚀 Fire Server Trigger
          </button>

          {triggerResult && (
            <span className="flex items-center text-sm text-slate-300 px-3">{triggerResult}</span>
          )}
        </div>

        {/* What to look for */}
        <div className="rounded-xl bg-slate-900 border border-slate-700 p-4 space-y-2 text-sm">
          <p className="text-slate-300 font-semibold">What to look for:</p>
          <div className="space-y-1 text-slate-400">
            <p>✅ <strong className="text-slate-200">PASS:</strong> "connected" event appears immediately, then "ping" events arrive every ~2 seconds. The proxy is NOT buffering.</p>
            <p>❌ <strong className="text-slate-200">FAIL:</strong> Connection error immediately, or events only appear after a long delay (proxy is buffering until the stream closes). Full SSE migration would not work.</p>
            <p>🚀 <strong className="text-slate-200">Trigger test:</strong> Click "Fire Server Trigger" while connected — the event should appear in the log instantly. This simulates a new lead arriving and the server pushing to all agents.</p>
          </div>
        </div>

        {/* Event log */}
        <div className="rounded-xl bg-slate-900 border border-slate-700 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-700 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Event Log</p>
            <p className="text-xs text-slate-500">{log.length} event{log.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="h-80 overflow-y-auto px-4 py-3 space-y-1.5">
            {log.length === 0 ? (
              <p className="text-slate-600 text-sm text-center py-8">No events yet — click Start Test</p>
            ) : (
              log.map((entry) => (
                <div key={entry.id} className={`flex gap-3 text-xs ${entry.ok ? "text-slate-300" : "text-red-400"}`}>
                  <span className="text-slate-600 shrink-0 w-20">{entry.ts}</span>
                  <span className={`shrink-0 w-28 font-semibold ${
                    entry.event.includes("✅") ? "text-emerald-400" :
                    entry.event.includes("🚀") ? "text-indigo-400" :
                    entry.event.includes("🎉") ? "text-amber-400" :
                    entry.event.includes("❌") ? "text-red-400" :
                    "text-slate-400"
                  }`}>{entry.event}</span>
                  <span className="text-slate-400 break-all">{
                    (() => {
                      try {
                        const parsed = JSON.parse(entry.data);
                        return parsed.message ?? entry.data;
                      } catch {
                        return entry.data;
                      }
                    })()
                  }</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        <p className="text-slate-600 text-xs text-center">
          This page is only for proxy verification — it will be removed after the SSE migration is confirmed.
        </p>
      </div>
    </div>
  );
}
