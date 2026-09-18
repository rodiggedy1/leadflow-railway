import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BarChart3,
  Building2,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  ContactRound,
  Crosshair,
  Download,
  Filter,
  List,
  Mail,
  MessageCircleMore,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Sparkles,
  Target,
  TriangleAlert,
  UserPlus,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import "./operations-crm-review.css";
import "./operations-crm-reference-fit.css";
import "./operations-crm-owner-portraits.css";

type CrmRow = {
  company: string;
  segments: Array<{ label: string; tone: "blue" | "green" | "amber" | "orange" | "rose" | "violet" }>;
  owner: string;
  deals: number;
  value: number;
  probability: number;
  activity: number[];
  interaction: string;
  interactionType: string;
};

const SAMPLE_ROWS: CrmRow[] = [
  { company: "Riverview Management", segments: [{ label: "Enterprise", tone: "blue" }, { label: "Expansion", tone: "green" }], owner: "Emma Green", deals: 9, value: 139007, probability: 45, activity: [4, 12, 8, 16, 11, 21, 13, 25, 20, 28, 18, 32], interaction: "Jul 18", interactionType: "Renewal" },
  { company: "Harbor & Finch", segments: [{ label: "Strategic", tone: "rose" }, { label: "Expansion", tone: "green" }], owner: "Mark Darnalds", deals: 8, value: 320222, probability: 86, activity: [6, 15, 8, 17, 27, 13, 23, 28, 19, 30, 24, 34], interaction: "Mar 15", interactionType: "Pilot" },
  { company: "Northstar Estates", segments: [{ label: "SMB", tone: "amber" }, { label: "Enterprise", tone: "blue" }], owner: "Kate Chen", deals: 8, value: 112277, probability: 24, activity: [3, 7, 16, 8, 11, 20, 5, 17, 11, 19, 8, 25], interaction: "Jun 7", interactionType: "Renewal" },
  { company: "Cedar Ridge Group", segments: [{ label: "Expansion", tone: "green" }], owner: "Oliver Chan", deals: 8, value: 289921, probability: 38, activity: [4, 8, 6, 21, 12, 26, 14, 9, 28, 12, 18, 31], interaction: "Aug 8", interactionType: "Partner" },
  { company: "Aster & Vale", segments: [{ label: "Enterprise", tone: "blue" }, { label: "Upsell", tone: "violet" }], owner: "Sarah Nguyen", deals: 7, value: 420000, probability: 70, activity: [11, 24, 10, 31, 17, 22, 32, 13, 26, 34, 21, 28], interaction: "Feb 21", interactionType: "QBR Call" },
  { company: "Summit House", segments: [{ label: "Pilot", tone: "orange" }], owner: "Alex Santos", deals: 6, value: 530111, probability: 82, activity: [8, 18, 26, 15, 29, 23, 31, 20, 33, 28, 36, 30], interaction: "Mar 12", interactionType: "Executive" },
  { company: "Juniper Collective", segments: [{ label: "Enterprise", tone: "blue" }, { label: "Mid-Market", tone: "green" }], owner: "Grace Miller", deals: 6, value: 520000, probability: 24, activity: [3, 12, 22, 9, 6, 16, 11, 21, 8, 26, 14, 19], interaction: "Sept 11", interactionType: "Pricing" },
  { company: "Atlas Property Co.", segments: [{ label: "Enterprise", tone: "blue" }], owner: "Maria Keller", deals: 5, value: 124232, probability: 22, activity: [5, 7, 17, 8, 20, 11, 18, 6, 22, 12, 24, 14], interaction: "Mar 12", interactionType: "Security" },
  { company: "Elm Street Partners", segments: [{ label: "Land & Expand", tone: "green" }], owner: "Hannah Mills", deals: 5, value: 170991, probability: 55, activity: [6, 20, 10, 28, 21, 8, 17, 29, 14, 25, 20, 32], interaction: "Jul 1", interactionType: "Expansion" },
  { company: "Wildwood Ventures", segments: [{ label: "Enterprise", tone: "blue" }, { label: "New Logo", tone: "green" }], owner: "James Taylor", deals: 4, value: 311242, probability: 51, activity: [7, 14, 20, 9, 25, 11, 17, 27, 14, 22, 30, 18], interaction: "Feb 22", interactionType: "Demo" },
  { company: "Canyon & Co.", segments: [{ label: "Mid-Market", tone: "green" }, { label: "Co-Sell", tone: "orange" }], owner: "Ava Brooks", deals: 4, value: 333221, probability: 23, activity: [5, 10, 17, 6, 21, 11, 15, 24, 8, 20, 12, 26], interaction: "Aug 12", interactionType: "Discovery" },
];

const NAV_PRIMARY = [
  { label: "Companies", icon: Building2, count: "241" },
  { label: "Deals Board", icon: ClipboardList },
  { label: "Forecast", icon: BarChart3, count: "9" },
  { label: "Activities", icon: List },
  { label: "Contacts", icon: ContactRound, count: "38" },
  { label: "Email Sequences", icon: Mail },
];

const NAV_GROUPS = [
  { label: "TEAM", items: [{ label: "Strategic AEs", icon: Target }, { label: "Mid Market", icon: Crosshair }, { label: "SDR Team", icon: UsersRound }] },
  { label: "REPORTING", items: [{ label: "Q1 Forecast", icon: ChartNoAxesColumnIncreasing }, { label: "Slipping Deals", icon: TriangleAlert }] },
];

const initials = (name: string) => name.split(" ").map(part => part[0]).join("").slice(0, 2);
const palette = ["#d76b5b", "#4ca1af", "#d19d48", "#9871d3", "#4e9a72", "#c46a85"];
const OWNER_PORTRAITS: Record<string, string> = {
  "Emma Green": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/gUCwvRBUvWDZUkGx.png",
  "Mark Darnalds": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ypcLWxzXhQzCCWcC.png",
  "Kate Chen": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/DOtabpUhLIcbLXur.png",
  "Oliver Chan": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/CucZtKJOfkDlJvMg.png",
  "Sarah Nguyen": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bCfFsxIPapKjJReA.png",
  "Alex Santos": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bvdqcqtPZSJhgtqq.png",
  "Grace Miller": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/VjRgwvLUkGAKxnVA.png",
  "Maria Keller": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/qRwiNDAHRQQTxPbz.png",
  "Hannah Mills": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/TtZGSsKomHzKvXmE.png",
  "James Taylor": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/xDBqJDhyFPziPsOt.png",
  "Ava Brooks": "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/tPTFyZvyIyVryrEa.png",
};

function OwnerPortrait({ owner, color, detail = false }: { owner: string; color: string; detail?: boolean }) {
  const portrait = OWNER_PORTRAITS[owner];
  if (portrait) return <img className={`ocr-owner-portrait${detail ? " ocr-owner-portrait-detail" : ""}`} src={portrait} alt={`${owner} static review portrait`} />;
  return <i style={{ background: color }}>{initials(owner)}</i>;
}

function ProbabilityMeter({ value }: { value: number }) {
  const filled = Math.max(1, Math.round(value / 10));
  return (
    <div className="ocr-probability" aria-label={`${value}% win probability`}>
      <div className="ocr-probability-bars" aria-hidden="true">
        {Array.from({ length: 10 }).map((_, index) => (
          <span key={index} className={index < filled ? `is-filled tone-${Math.min(3, Math.floor((index / 10) * 4))}` : ""} />
        ))}
      </div>
      <strong>{value}%</strong>
    </div>
  );
}

function ActivityBars({ values }: { values: number[] }) {
  return (
    <div className="ocr-activity-bars" aria-label="Sample activity trend">
      {values.map((height, index) => <span key={index} style={{ height: `${Math.max(4, Math.min(16, Math.round(height * 0.43)))}px` }} />)}
    </div>
  );
}

function FilterControl({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="ocr-filter" onClick={onClick}>
      <span className="ocr-filter-label">{label}</span>
      <strong>{value}</strong>
      <ChevronDown size={14} />
    </button>
  );
}

function SalesCrmLogo() {
  return (
    <svg className="ocr-logo-mark" viewBox="0 0 40 41" fill="none" aria-hidden="true">
      <rect width="32" height="32" x="4" y="1" fill="#2A2A2A" rx="8" />
      <path fill="#fff" fillRule="evenodd" d="M17.172 8c-1.016 0-1.99.403-2.708 1.121L11 12.586v1.586c0 1.12.481 2.128 1.248 2.828A3.82 3.82 0 0 0 11 19.828v1.586l3.464 3.465A3.83 3.83 0 0 0 20 24.752a3.828 3.828 0 0 0 5.535.127L29 21.414v-1.586c0-1.12-.481-2.128-1.248-2.828A3.82 3.82 0 0 0 29 14.172v-1.586L25.535 9.12A3.83 3.83 0 0 0 20 9.248 3.82 3.82 0 0 0 17.172 8m5.42 9a4 4 0 0 1-.127-.121L20 14.414l-2.465 2.465a4 4 0 0 1-.127.121q.066.06.127.121L20 19.586l2.465-2.465q.061-.062.127-.121M21 21.414v.758a1.828 1.828 0 0 0 3.121 1.293L27 20.585v-.757a1.828 1.828 0 0 0-3.121-1.293zm-2 0-2.879-2.879A1.828 1.828 0 0 0 13 19.829v.758l2.879 2.879A1.828 1.828 0 0 0 19 22.172zm0-9.586v.758l-2.879 2.878A1.828 1.828 0 0 1 13 14.173v-.758l2.879-2.878A1.828 1.828 0 0 1 19 11.828m4.879 3.637L21 12.584v-.757a1.828 1.828 0 0 1 3.121-1.292L27 13.414v.758a1.828 1.828 0 0 1-3.121 1.292" clipRule="evenodd" />
    </svg>
  );
}

const HEALTH_STAGES = [
  { label: "Discovery", value: 17, tone: "coral" },
  { label: "Evaluation", value: 29, tone: "amber" },
  { label: "Procurement", value: 17, tone: "mint" },
] as const;

function DetailHealthBar({ value, tone }: { value: number; tone: "coral" | "amber" | "mint" }) {
  const filled = Math.round((value / 100) * 58);
  return <div className="ocr-detail-health-bar" aria-label={`${value}% ${tone} pipeline health`}>{Array.from({ length: 58 }).map((_, index) => <i key={index} className={index < filled ? `is-filled is-${tone}` : ""} />)}</div>;
}

function DetailActivitySparkline({ values }: { values: number[] }) {
  return <div className="ocr-detail-sparkline" aria-hidden="true">{values.slice(0, 11).map((height, index) => <i key={index} style={{ height: `${Math.max(7, Math.round(height * 0.58))}px` }} />)}</div>;
}

function CompanyDetailDrawer({ row, onClose }: { row: CrmRow; onClose: () => void }) {
  const [notice, setNotice] = useState("");
  const ownerEmail = `${row.owner.toLowerCase().replace(/\s+/g, ".")}@crm.com`;
  const totalTouches = Math.max(24, row.activity.reduce((total, value) => total + value, 0) % 76 + 24);

  return (
    <>
      <button type="button" className="ocr-drawer-backdrop" aria-label="Close static company details" onClick={onClose} />
      <aside className="ocr-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="ocr-detail-title">
        <header className="ocr-detail-drawer-header">
          <div><Building2 size={16} strokeWidth={1.5} /><strong>Companies Detail</strong></div>
          <button type="button" aria-label="Close static company details" onClick={onClose}><X size={18} strokeWidth={1.6} /></button>
        </header>

        <div className="ocr-detail-drawer-scroll">
          <section className="ocr-detail-identity">
            <div className="ocr-detail-company-mark"><Building2 size={31} strokeWidth={1.4} /></div>
            <div>
              <h2 id="ocr-detail-title">{row.company}</h2>
              <div className="ocr-detail-pills">{row.segments.slice(0, 2).map(segment => <span key={segment.label} className={`ocr-pill ocr-pill-${segment.tone}`}>{segment.label}</span>)}</div>
            </div>
          </section>

          <section className="ocr-detail-section ocr-detail-summary">
            <h3>Account summary</h3>
            <div className="ocr-detail-contact">
              <OwnerPortrait owner={row.owner} color={palette[(SAMPLE_ROWS.indexOf(row) + 1) % palette.length]} detail />
              <strong>{row.owner}</strong>
              <span><Mail size={15} fill="currentColor" />{ownerEmail}</span>
              <span><Phone size={15} fill="currentColor" />+1 (202) 211-5964</span>
            </div>
          </section>

          <section className="ocr-detail-section ocr-detail-pipeline">
            <h3>Pipeline health</h3>
            <strong className="ocr-detail-probability">{row.probability}%</strong>
            <p>Win probability across all open deals</p>
            <div className="ocr-detail-health-list">
              {HEALTH_STAGES.map(stage => <div key={stage.label}><div><span>{stage.label}</span><strong>{stage.value}%</strong></div><DetailHealthBar value={stage.value} tone={stage.tone} /></div>)}
            </div>
          </section>

          <section className="ocr-detail-section ocr-detail-activity">
            <div className="ocr-detail-section-heading"><h3>Activity trend</h3><button type="button">Last 30 Days<ChevronDown size={14} strokeWidth={1.5} /></button></div>
            <div className="ocr-detail-activity-total"><strong>{totalTouches}</strong><DetailActivitySparkline values={row.activity} /></div>
            <p>Spikes around QBR prep and renewal review</p>
            <div className="ocr-detail-stat-grid">
              <div><span><Sparkles size={14} />Total touches</span><strong>{totalTouches}</strong></div>
              <div><span><Mail size={14} fill="currentColor" />Emails</span><strong>{Math.max(10, Math.round(totalTouches * .36))}</strong></div>
              <div><span><CalendarDays size={14} />Meetings</span><strong>{Math.max(3, Math.round(totalTouches * .14))}</strong></div>
              <div><span><MessageCircleMore size={14} />Calls &amp; notes</span><strong>{Math.max(7, Math.round(totalTouches * .28))}</strong></div>
            </div>
          </section>

          <section className="ocr-detail-section ocr-detail-scorecard">
            <div className="ocr-detail-section-heading"><h3>Score card</h3><button type="button">Last 30 Days<ChevronDown size={14} strokeWidth={1.5} /></button></div>
            {["Business fit", "Technical fit", "Stakeholder alignment"].map((label, index) => <article key={label}>
              <strong>{label}</strong>
              <p>{index === 0 ? "Evaluates how well the company aligns with our ideal customer profile." : "Evaluates the account signals present in this static review preview."}</p>
              <footer><span><i style={{ background: palette[(index + 2) % palette.length] }}>{initials(["Emma Green", "Ricky Brown", "Taylor Leroy"][index])}</i>{["Emma Green", "Ricky Brown", "Taylor Leroy"][index]} <em>Updated 2h ago</em></span><b>High potential <span>SN</span></b></footer>
            </article>)}
          </section>
        </div>

        <footer className="ocr-detail-drawer-footer">
          <a href="#review-only-help">Need help? Ask us.</a>
          <div><button type="button" onClick={onClose}>Cancel</button><button type="button" className="ocr-detail-save" onClick={() => setNotice("Static review only — no company data was changed.")}>Save Update</button></div>
          <span className="sr-only" aria-live="polite">{notice}</span>
        </footer>
      </aside>
    </>
  );
}

export default function OperationsCRMReview() {
  const [activeTab, setActiveTab] = useState("Companies");
  const [activeNav, setActiveNav] = useState("Companies");
  const [selected, setSelected] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<CrmRow | null>(null);

  const isAllSelected = selected.length === SAMPLE_ROWS.length;
  const pipelineTotal = useMemo(() => SAMPLE_ROWS.reduce((total, row) => total + row.value, 0), []);
  const averageProbability = useMemo(() => Math.round(SAMPLE_ROWS.reduce((total, row) => total + row.probability, 0) / SAMPLE_ROWS.length), []);

  const toggleRow = (company: string) => {
    setSelected(current => current.includes(company) ? current.filter(item => item !== company) : [...current, company]);
  };

  const toggleAll = () => setSelected(isAllSelected ? [] : SAMPLE_ROWS.map(row => row.company));

  useEffect(() => {
    if (!detailRow) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailRow(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailRow]);

  return (
    <div className="operations-crm-review" data-review-only="true">
      <aside className="ocr-sidebar" aria-label="Leads CRM review navigation">
        <div className="ocr-brand">
          <SalesCrmLogo />
          <div><strong>Leads CRM</strong><span>Lead pipeline</span></div>
        </div>

        <div className="ocr-nav-scroll">
          <nav className="ocr-nav-primary" aria-label="CRM primary navigation">
            {NAV_PRIMARY.map(({ label, icon: Icon, count }) => (
              <button type="button" key={label} className={activeNav === label ? "is-active" : ""} onClick={() => setActiveNav(label)}>
                <Icon size={14} strokeWidth={1.4} /><span>{label}</span>{count && <b>{count}</b>}
              </button>
            ))}
          </nav>

          {NAV_GROUPS.map(group => (
            <section className="ocr-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(({ label, icon: Icon }) => <button type="button" key={label} onClick={() => setActiveNav(label)} className={activeNav === label ? "is-active" : ""}><Icon size={14} strokeWidth={1.4} /><span>{label}</span></button>)}
            </section>
          ))}

          <section className="ocr-nav-group ocr-pipelines">
            <p>PIPELINES</p>
            <button type="button"><i className="dot-yellow" />North America</button>
            <button type="button"><i className="dot-pink" />EMEA Enterprise</button>
            <button type="button"><i className="dot-violet" />APAC Expansion</button>
          </section>
        </div>

        <div className="ocr-nav-utility">
          <button type="button"><UserPlus size={14} strokeWidth={1.4} />Invite teammates</button>
          <button type="button"><CircleHelp size={14} strokeWidth={1.4} />Help</button>
        </div>

        <div className="ocr-sidebar-footer">
          <div className="ocr-trial"><div><strong>14 Days</strong><span>Left on trials</span></div><button type="button"><WalletCards size={14} strokeWidth={1.4} />Add Billings</button></div>
        </div>
      </aside>

      <main className="ocr-workspace">
        <header className="ocr-header">
          <div className="ocr-page-title"><h1>Leads</h1><span><i />Static review</span></div>
          <div className="ocr-header-actions">
            <button type="button" aria-label="Search preview"><Search size={18} /></button>
            <button type="button" aria-label="Preview notifications" className="has-notification"><Bell size={18} /></button>
            <button type="button" className="ocr-profile"><i>JA</i><span>Jensen Ackles</span><ChevronDown size={14} /></button>
          </div>
        </header>

        <section className="ocr-tabs" aria-label="CRM workspace tabs">
          {["Leads", "Deals", "Forecast"].map(tab => <button type="button" key={tab} className={activeTab === tab ? "is-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        </section>

        <section className="ocr-toolbar" aria-label="Preview toolbar">
          <div className="ocr-toolbar-filters">
            <FilterControl label="Sort by" value="Open Deals" onClick={() => setFilterOpen(current => !current)} />
            <FilterControl label="Filter" value="All Owners" onClick={() => setFilterOpen(current => !current)} />
            <FilterControl label="Stage" value="Any" onClick={() => setFilterOpen(current => !current)} />
            <FilterControl label="Last Activity" value="90 Days" onClick={() => setFilterOpen(current => !current)} />
            {filterOpen && <div className="ocr-filter-note"><Filter size={14} />Preview controls only — no LeadFlow data is queried.</div>}
          </div>
          <div className="ocr-toolbar-actions">
            <button type="button" className="ocr-export"><Download size={16} />Export</button>
            <button type="button" className="ocr-new-company"><Plus size={14} />New Company</button>
          </div>
        </section>

        <section className="ocr-table-shell" aria-label={`${activeTab} static review table`}>
          <div className="ocr-table-scroll">
            <table className="ocr-table">
              <thead>
                <tr>
                  <th className="ocr-checkbox-column"><button type="button" className={`ocr-checkbox ${isAllSelected ? "is-selected" : ""}`} onClick={toggleAll} aria-label="Select all sample companies">{isAllSelected && "✓"}</button></th>
                  <th>Companies</th><th>Segment &amp; Stage</th><th>Account owner</th><th>Open deals</th><th>Pipeline value</th><th>Win probability</th><th>Activity trend</th><th>Last interaction</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((row, rowIndex) => {
                  const isSelected = selected.includes(row.company);
                  return (
                    <tr key={row.company} className={isSelected ? "is-selected" : ""} onClick={() => setDetailRow(row)}>
                      <td className="ocr-checkbox-column"><button type="button" className={`ocr-checkbox ${isSelected ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); toggleRow(row.company); }} aria-label={`Select ${row.company}`}>{isSelected && "✓"}</button></td>
                      <td className="ocr-company"><button type="button" onClick={() => setDetailRow(row)}>{row.company}</button></td>
                      <td><div className="ocr-pill-group">{row.segments.map(segment => <span key={segment.label} className={`ocr-pill ocr-pill-${segment.tone}`}>{segment.label}</span>)}{rowIndex % 3 === 2 && <span className="ocr-pill ocr-pill-more">+2</span>}</div></td>
                      <td><button type="button" className="ocr-owner" onClick={() => setDetailRow(row)}><OwnerPortrait owner={row.owner} color={palette[rowIndex % palette.length]} /><span>{row.owner}</span></button></td>
                      <td className="ocr-number">{row.deals}</td>
                      <td className="ocr-money"><span>$</span>{row.value.toLocaleString("en-US")}</td>
                      <td><ProbabilityMeter value={row.probability} /></td>
                      <td><ActivityBars values={row.activity} /></td>
                      <td><div className="ocr-interaction"><CalendarDays size={15} /><span>{row.interaction}</span><i /><strong>{row.interactionType}</strong></div></td>
                      <td><button type="button" className="ocr-overflow" aria-label={`Open ${row.company} sample details`} onClick={() => setDetailRow(row)}><MoreHorizontal size={19} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="ocr-calculation-footer">
            <div>{SAMPLE_ROWS.length} sample companies in view</div>
            <div><Plus size={13} />Pipeline total <strong>${pipelineTotal.toLocaleString("en-US")}</strong></div>
            <div><Plus size={13} />Avg win probability <strong>{averageProbability}%</strong></div>
            <button type="button"><Plus size={13} />Add calculation</button>
          </footer>
        </section>
      </main>
      {detailRow && <CompanyDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  );
}
