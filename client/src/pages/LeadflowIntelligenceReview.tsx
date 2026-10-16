import { useMemo, useState } from "react";
import "./leadflow-intelligence-review.css";

type Stage = {
  name: string;
  value: number;
  color: string;
};

type Metric = [string, string];

const STAGES: Stage[] = [
  { name: "New Leads", value: 2480, color: "#607c5b" },
  { name: "Contacted", value: 2046, color: "#789a69" },
  { name: "Engaged", value: 1378, color: "#92b979" },
  { name: "Quoted", value: 918, color: "#a9d187" },
  { name: "Booking Intent", value: 642, color: "#b9e48e" },
  { name: "Booked", value: 487, color: "#c5f58a" },
];

const SAMPLE_LEADS = [
  ["Sarah Mitchell", "Thumbtack"],
  ["James Carter", "Google"],
  ["Emily Wilson", "Thumbtack"],
  ["Marcus Johnson", "Google"],
] as const;

const DEFAULT_MESSAGE =
  "Hi {{first_name}}, this is Madison from Maids in Black. Just following up on your cleaning request. Would you like help finding an available time?";

const fmt = (value: number) => value.toLocaleString("en-US");

export default function LeadflowIntelligenceReview() {
  const [selected, setSelected] = useState(2);
  const [period, setPeriod] = useState(30);
  const [channel, setChannel] = useState<"SMS" | "Email">("SMS");
  const [tab, setTab] = useState<"funnel" | "cohorts" | "campaigns">("funnel");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const count = (index: number) =>
    Math.round(STAGES[index].value * (period === 7 ? 0.27 : period === 90 ? 2.65 : 1));

  const conversion = (index: number) =>
    index ? `${((count(index) / count(index - 1)) * 100).toFixed(1)}%` : "Entry";

  const activeStage = STAGES[selected];
  const metrics: Metric[] = [
    ["TOTAL LEADS", fmt(count(0))],
    ["BOOKINGS", fmt(count(5))],
    ["FUNNEL CONVERSION", `${((count(5) / count(0)) * 100).toFixed(1)}%`],
    ["EST. BOOKED VALUE", `$${fmt(count(5) * 287)}`],
  ];

  const audienceOptions = useMemo(
    () => STAGES.map((stage, index) => ({ ...stage, index, count: count(index) })),
    [period, selected],
  );

  const selectTab = (nextTab: typeof tab) => {
    setTab(nextTab);
    setStatus("");
  };

  const reset = () => {
    setSelected(2);
    setPeriod(30);
    setChannel("SMS");
    setTab("funnel");
    setMessage(DEFAULT_MESSAGE);
    setStatus("");
    setHistory([]);
  };

  const rewrite = () => {
    setMessage(
      "Hi {{first_name}}! Madison from Maids in Black here. Your cleaning request is still on our radar. Would you like me to find an appointment that works for you?",
    );
    setStatus("Suggested rewrite added for your review.");
  };

  const previewAudience = () => {
    setStatus(
      `Audience preview: ${fmt(count(selected))} stage members. Actual eligible recipients would require consent and opt-out checks.`,
    );
  };

  const schedule = () => {
    if (!message.trim()) {
      setStatus("Enter a message first.");
      return;
    }
    setHistory((current) => [
      `${channel} · ${activeStage.name} · ${fmt(count(selected))} potential recipients`,
      ...current,
    ]);
    setStatus("✓ Prototype campaign saved locally in this page. No real messages sent.");
  };

  return (
    <div className="leadflow-intelligence-review">
      <header className="lir-header">
        <div>
          <h1>▣ LeadFlow <span className="lir-muted">/ Intelligence</span></h1>
          <small>Revenue Operations Command Center · Interactive demo</small>
        </div>
        <div className="lir-flex lir-header-controls">
          <span className="lir-green">● LIVE SIMULATION</span>
          <select
            aria-label="Reporting period"
            value={period}
            onChange={(event) => setPeriod(Number(event.target.value))}
          >
            <option value={30}>Last 30 days</option>
            <option value={7}>Last 7 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button type="button" onClick={reset}>↻ Reset</button>
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.()}>⛶ Fullscreen</button>
        </div>
      </header>

      <nav className="lir-tabs" aria-label="Intelligence sections">
        {([
          ["funnel", "◈ Funnel Intelligence"],
          ["cohorts", "◎ Cohort Explorer"],
          ["campaigns", "↗ Campaigns"],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => selectTab(value)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="lir-main">
        <div className="lir-metrics">
          {metrics.map(([label, value]) => (
            <div className="lir-panel" key={label}>
              <small>{label}</small>
              <div className="lir-metric">{value}</div>
              <small className="lir-green">{label === "FUNNEL CONVERSION" ? "Lead → confirmed" : "Illustrative data"}</small>
            </div>
          ))}
        </div>

        {tab === "funnel" && (
          <section>
            <div className="lir-layout">
              <div className="lir-panel lir-funnel-panel">
                <div className="lir-flex">
                  <div>
                    <h2>Live conversion funnel</h2>
                    <small>Click any stage to select its audience</small>
                  </div>
                  <span className="lir-green">● Interactive</span>
                </div>
                <svg className="lir-funnel" viewBox="0 0 700 620" role="img" aria-label="Interactive lead conversion funnel">
                  {STAGES.map((stage, index) => {
                    const width = 570 - index * 75;
                    const y = 20 + index * 97;
                    const x = (700 - width) / 2;
                    const nextWidth = 570 - (index + 1) * 75;
                    const nextX = (700 - nextWidth) / 2;
                    const points = index === 5
                      ? `${x},${y} ${x + width},${y} ${x + width - 20},${y + 81} ${x + 20},${y + 81}`
                      : `${x},${y} ${x + width},${y} ${nextX + nextWidth},${y + 81} ${nextX},${y + 81}`;
                    const isSelected = index === selected;
                    return (
                      <g
                        className={`lir-stage ${isSelected ? "selected" : ""}`}
                        key={stage.name}
                        onClick={() => setSelected(index)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") setSelected(index);
                        }}
                      >
                        <polygon points={points} fill={stage.color} stroke={isSelected ? "#f2ffd9" : "#90b881"} strokeWidth={isSelected ? 3 : 1} />
                        <text x="350" y={y + 32} textAnchor="middle" fontSize="16" fontWeight="700" fill="#182519">{stage.name.toUpperCase()}</text>
                        <text x="350" y={y + 62} textAnchor="middle" fontSize="28" fontWeight="800" fill="#182519">{fmt(count(index))}</text>
                        {index > 0 && (
                          <>
                            <rect x="572" y={y - 15} width="115" height="29" rx="14" fill="#243226" stroke="#4a6548" />
                            <text x="629" y={y + 4} textAnchor="middle" fill="#c5f58a" fontSize="14">{conversion(index)} ↓</text>
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="lir-panel lir-inspector">
                <small>ACTIVE COHORT · 0{selected + 1}/06</small>
                <h2>{activeStage.name}</h2>
                <div className="lir-metric">{fmt(count(selected))} <small>leads</small></div>
                <div className="lir-row lir-flex"><span className="lir-muted">Stage conversion</span><b className="lir-green">{conversion(selected)}</b></div>
                <div className="lir-row lir-flex"><span className="lir-muted">Share of all leads</span><b>{((100 * count(selected)) / count(0)).toFixed(1)}%</b></div>
                <div className="lir-row lir-flex"><span className="lir-muted">Drop-off from previous</span><b>{selected ? fmt(count(selected - 1) - count(selected)) : "—"}</b></div>
                <div className="lir-btnrow">
                  <button type="button" className="primary" onClick={() => selectTab("campaigns")}>✉ Message cohort ↗</button>
                  <button type="button" onClick={() => selectTab("cohorts")}>Explore cohorts</button>
                </div>
                <h3 className="lir-activity-title">Sample lead activity</h3>
                {SAMPLE_LEADS.map(([name, source], index) => (
                  <div className="lir-row lir-flex" key={name}>
                    <span>{name}<br /><small>{source} · {index + 1}h ago</small></span>
                    <button type="button" onClick={() => selectTab("campaigns")}>↗</button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {tab === "cohorts" && (
          <section className="lir-section">
            <h2>Cohort Explorer</h2>
            <p className="lir-muted">Choose any cohort to start a targeted campaign.</p>
            <div className="lir-cohorts">
              {audienceOptions.map((stage) => (
                <button type="button" className="lir-panel lir-cohort" key={stage.name} onClick={() => { setSelected(stage.index); selectTab("campaigns"); }}>
                  <small>STAGE 0{stage.index + 1}</small>
                  <h3>{stage.name}</h3>
                  <div className="lir-metric">{fmt(stage.count)}</div>
                  <small>Conversion: {conversion(stage.index)}</small>
                  <p className="lir-green">Message cohort ↗</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === "campaigns" && (
          <section className="lir-section">
            <h2>Campaign Studio</h2>
            <div className="lir-panel lir-campaign-panel">
              <h3>New outreach campaign</h3>
              <small>Demo only — no messages will be sent.</small>
              <label htmlFor="lir-audience">Target audience</label>
              <select id="lir-audience" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
                {audienceOptions.map((stage) => <option value={stage.index} key={stage.name}>{stage.name} · {fmt(stage.count)} leads</option>)}
              </select>
              <p className="lir-green">{fmt(count(selected))} leads in selected funnel stage</p>
              <label>Channel</label>
              <div className="lir-btnrow">
                {(["SMS", "Email"] as const).map((value) => <button type="button" className={channel === value ? "active" : ""} key={value} onClick={() => setChannel(value)}>{value}</button>)}
              </div>
              <label htmlFor="lir-message">Message</label>
              <textarea id="lir-message" value={message} onChange={(event) => setMessage(event.target.value)} />
              <div className="lir-btnrow">
                <button type="button" onClick={rewrite}>✦ AI rewrite preview</button>
                <button type="button" onClick={previewAudience}>Preview audience</button>
                <button type="button" className="primary" onClick={schedule}>Schedule campaign ↗</button>
              </div>
              {status && <div className="lir-status" role="status">{status}</div>}
              <label>Message preview</label>
              <div className="lir-panel lir-message-preview">{message}</div>
            </div>
            {history.length > 0 && <div className="lir-history"><h3>Campaign drafts</h3>{history.map((entry, index) => <div className="lir-panel" key={`${entry}-${index}`}>{entry} <span className="lir-green">· Prototype draft saved</span></div>)}</div>}
          </section>
        )}
      </main>
    </div>
  );
}
