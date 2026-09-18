import { useMemo, useState } from "react";
import { Award, ChevronRight, Eye, Layers3, ListChecks, MessageSquareText, PanelRight, Search, ShieldCheck, Sparkles, Star, TriangleAlert, UsersRound } from "lucide-react";
import "./reviews-quality-review.css";
import "./reviews-quality-fit.css";

type ReviewScope = "all" | "ratings" | "recleans";

type RankingSlot = {
  rank: string;
  teamSlot: string;
  reviewSignal: string;
  ratingSignal: string;
  outcome: string;
};

type ReviewRecord = {
  id: string;
  kind: "Review record" | "Reclean-linked review";
  teamSlot: string;
  serviceContext: string;
  reviewState: string;
  responseState: string;
  recleanState: string;
  category: "ratings" | "recleans";
};

const RANKING_SLOTS: RankingSlot[] = [
  { rank: "01", teamSlot: "Team ranking slot 01", reviewSignal: "Review volume held for live connection", ratingSignal: "Rating average withheld", outcome: "Review funnel detail" },
  { rank: "02", teamSlot: "Team ranking slot 02", reviewSignal: "Review volume held for live connection", ratingSignal: "Rating average withheld", outcome: "Review funnel detail" },
  { rank: "03", teamSlot: "Team ranking slot 03", reviewSignal: "Review volume held for live connection", ratingSignal: "Rating average withheld", outcome: "Review funnel detail" },
  { rank: "04", teamSlot: "Team ranking slot 04", reviewSignal: "Review volume held for live connection", ratingSignal: "Rating average withheld", outcome: "Review funnel detail" },
];

const REVIEW_RECORDS: ReviewRecord[] = [
  { id: "RV-104", kind: "Review record", teamSlot: "Team ranking slot 01", serviceContext: "Service context withheld on review link", reviewState: "Review detail ready", responseState: "Response detail withheld", recleanState: "No reclean decision shown", category: "ratings" },
  { id: "RV-103", kind: "Reclean-linked review", teamSlot: "Team ranking slot 03", serviceContext: "Service context withheld on review link", reviewState: "Quality follow-up context", responseState: "Response detail withheld", recleanState: "Reclean decision review", category: "recleans" },
  { id: "RV-102", kind: "Review record", teamSlot: "Team ranking slot 02", serviceContext: "Service context withheld on review link", reviewState: "Review detail ready", responseState: "Response detail withheld", recleanState: "No reclean decision shown", category: "ratings" },
  { id: "RV-101", kind: "Reclean-linked review", teamSlot: "Team ranking slot 04", serviceContext: "Service context withheld on review link", reviewState: "Closeout context ready", responseState: "Response detail withheld", recleanState: "Reclean closeout review", category: "recleans" },
];

function StaticAction({ label, className = "", onClick }: { label: string; className?: string; onClick: () => void }) {
  return <button type="button" className={className} onClick={onClick}>{label}</button>;
}

function LocalNotice({ message }: { message: string }) {
  return <div className="rqd-notice" role="status">{message}</div>;
}

function RankingBoard({ onSelect }: { onSelect: (slot: RankingSlot) => void }) {
  return <section className="rqd-ranking-panel"><header className="rqd-section-head"><div><small>TEAM RANKING</small><h2>Ranked by reviews</h2><p>Review-ranked team layout</p></div><Award size={18} /></header><div className="rqd-ranking-legend"><span>RANK</span><span>TEAM</span><span>RATING</span></div><div className="rqd-ranking-list">{RANKING_SLOTS.map(slot => <button type="button" key={slot.rank} onClick={() => onSelect(slot)} aria-label={`Open static team ranking ${slot.rank}`}><b>{slot.rank}</b><span><strong>{slot.teamSlot}</strong><small>{slot.reviewSignal}</small></span><em><Star size={13} /><i>{slot.ratingSignal}</i></em></button>)}</div><footer><span>Team identities, review totals, rating averages, and ranking order are withheld on the isolated review link.</span><Layers3 size={15} /></footer></section>;
}

function ReviewRow({ record, selected, onSelect }: { record: ReviewRecord; selected: boolean; onSelect: () => void }) {
  const isReclean = record.category === "recleans";
  return <button type="button" className={`rqd-review-row ${selected ? "is-selected" : ""} ${isReclean ? "is-reclean" : ""}`} onClick={onSelect} aria-label={`Open static ${record.kind} ${record.id}`}><span className="rqd-review-icon">{isReclean ? <TriangleAlert size={16} /> : <Star size={16} />}</span><span className="rqd-review-main"><small>{record.id} · STATIC {record.kind.toUpperCase()}</small><strong>{record.teamSlot}</strong><em>{record.serviceContext}</em></span><span className="rqd-review-state"><b>{record.reviewState}</b><i>{record.recleanState}</i></span><ChevronRight size={16} /></button>;
}

function RecentReviews({ scope, selectedId, onSelect }: { scope: ReviewScope; selectedId: string; onSelect: (record: ReviewRecord) => void }) {
  const records = useMemo(() => scope === "all" ? REVIEW_RECORDS : REVIEW_RECORDS.filter(record => record.category === scope), [scope]);
  return <section className="rqd-recent-panel"><header className="rqd-section-head"><div><small>RECENT REVIEWS</small><h2>Review activity &amp; details</h2><p>{records.length} static row{records.length === 1 ? "" : "s"} shown in this local view.</p></div><Search size={18} /></header><div className="rqd-review-list">{records.map(record => <ReviewRow key={record.id} record={record} selected={selectedId === record.id} onSelect={() => onSelect(record)} />)}</div></section>;
}

function RecleanLane({ onSelect }: { onSelect: (record: ReviewRecord) => void }) {
  const recleanRecords = REVIEW_RECORDS.filter(record => record.category === "recleans");
  return <section className="rqd-reclean-lane"><header><div><small>RECLEANS</small><h2>Linked quality review</h2></div><TriangleAlert size={17} /></header><div>{recleanRecords.map(record => <button type="button" key={record.id} onClick={() => onSelect(record)}><span><TriangleAlert size={14} /></span><div><strong>{record.id} · {record.recleanState}</strong><small>{record.teamSlot}</small></div><ChevronRight size={14} /></button>)}</div><p>Reclean records remain a focused lane inside Reviews &amp; Quality; this review link cannot create, schedule, or change one.</p></section>;
}

function RankingDetail({ slot }: { slot: RankingSlot }) {
  return <><div className="rqd-detail-kicker"><Award size={14} />TEAM RANKING DETAIL</div><h2>{slot.teamSlot}</h2><p className="rqd-detail-intro">This panel is the intended destination for a selected ranked team.</p><section><small>RANK</small><strong>Static rank slot {slot.rank}</strong></section><section><small>REVIEW VOLUME</small><strong>{slot.reviewSignal}</strong></section><section><small>AVERAGE RATING</small><strong>{slot.ratingSignal}</strong></section><section><small>REVIEW FUNNEL</small><strong>{slot.outcome}</strong></section></>;
}

function ReviewDetail({ record }: { record: ReviewRecord }) {
  const isReclean = record.category === "recleans";
  return <><div className="rqd-detail-kicker">{isReclean ? <TriangleAlert size={14} /> : <MessageSquareText size={14} />}REVIEW DETAIL</div><h2>{record.id} · {record.kind}</h2><p className="rqd-detail-intro">The selected review context stays visible without pretending the review content is available in this static review environment.</p><section><small>TEAM</small><strong>{record.teamSlot}</strong></section><section><small>SERVICE CONTEXT</small><strong>{record.serviceContext}</strong></section><section><small>RATING</small><strong>Rating value withheld on review link</strong></section><section><small>REVIEW RESPONSE</small><strong>{record.responseState}</strong></section><section><small>RECLEAN STATUS</small><strong>{record.recleanState}</strong></section></>;
}

function DetailPanel({ selectedReview, selectedRanking, onNotice }: { selectedReview: ReviewRecord | null; selectedRanking: RankingSlot | null; onNotice: (label: string) => void }) {
  return <aside className="rqd-detail-panel"><header><div><small>DETAIL WORKSPACE</small><p>Static review only</p></div><PanelRight size={18} /></header><div className="rqd-detail-body">{selectedReview ? <ReviewDetail record={selectedReview} /> : selectedRanking ? <RankingDetail slot={selectedRanking} /> : <><div className="rqd-detail-kicker"><Eye size={14} />REVIEW DETAIL</div><h2>Select a recent review</h2><p className="rqd-detail-intro">The selected review’s team, service context, rating, response, and reclean status will be shown here in the production data view.</p></>}<div className="rqd-detail-boundary"><ShieldCheck size={15} /><div><strong>Static review boundary</strong><p>No team rank, rating, review content, response, reclean, message, booking, or customer record is loaded or changed here.</p></div></div></div><footer><StaticAction label="Open static history" onClick={() => onNotice("Review history")} className="rqd-secondary-button" /><StaticAction label="Log local review" onClick={() => onNotice("Review detail")} className="rqd-primary-button" /></footer></aside>;
}

export default function ReviewsQualityReview() {
  const [scope, setScope] = useState<ReviewScope>("all");
  const [selectedReview, setSelectedReview] = useState<ReviewRecord | null>(REVIEW_RECORDS[0]);
  const [selectedRanking, setSelectedRanking] = useState<RankingSlot | null>(null);
  const [notice, setNotice] = useState("");
  const notify = (label: string) => setNotice(`${label} is a local review-only state. No ranking, rating, review, response, reclean, team, customer, message, booking, or operational action was performed.`);
  const selectReview = (record: ReviewRecord) => { setSelectedReview(record); setSelectedRanking(null); };
  const selectRanking = (slot: RankingSlot) => { setSelectedRanking(slot); setSelectedReview(null); };

  return <main className="reviews-quality-review" data-review-only="true"><header className="rqd-topbar"><div className="rqd-crumb"><span>TEAM OPERATIONS</span><ChevronRight size={13} /><strong>Reviews &amp; Quality</strong><i>Static review</i></div><div className="rqd-top-actions"><button type="button" onClick={() => notify("Static review search")} aria-label="Search static review records"><Search size={15} /></button><button type="button" onClick={() => notify("Static review actions")} aria-label="Open static review actions"><Sparkles size={15} /></button></div></header><section className="rqd-page-header"><div><span>REVIEWS &amp; QUALITY CONTROL</span><h1>Reviews &amp; Quality</h1><p>Rank teams by reviews, inspect recent review activity, and keep the right detail context visible.</p></div><div className="rqd-header-actions"><StaticAction label="Open recent reviews" onClick={() => notify("Recent reviews")} className="rqd-primary-button" /><StaticAction label="View recleans" onClick={() => { setScope("recleans"); notify("Reclean review lane"); }} className="rqd-secondary-button" /></div></section><section className="rqd-summary-strip" aria-label="Reviews and Quality static layout summary"><article><span className="violet"><UsersRound size={16} /></span><div><small>TEAM RANKING</small><strong>Review-based</strong><p>Layout ready for live team metrics</p></div></article><article><span className="amber"><Star size={16} /></span><div><small>RECENT REVIEWS</small><strong>Detail-first</strong><p>Rating and response context</p></div></article><article><span className="coral"><TriangleAlert size={16} /></span><div><small>RECLEANS</small><strong>Linked lane</strong><p>Quality decision context</p></div></article><article><span className="mint"><ListChecks size={16} /></span><div><small>REVIEW OUTCOME</small><strong>Visible</strong><p>Static review state only</p></div></article></section><nav className="rqd-tabs" aria-label="Review workspace sections"><button type="button" className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>All review activity</button><button type="button" className={scope === "ratings" ? "is-active" : ""} onClick={() => setScope("ratings")}>Rating follow-up</button><button type="button" className={scope === "recleans" ? "is-active" : ""} onClick={() => setScope("recleans")}>Recleans</button></nav>{notice && <LocalNotice message={notice} />}<section className="rqd-workspace"><RankingBoard onSelect={selectRanking} /><div className="rqd-center-column"><RecentReviews scope={scope} selectedId={selectedReview?.id ?? ""} onSelect={selectReview} /><RecleanLane onSelect={selectReview} /></div><DetailPanel selectedReview={selectedReview} selectedRanking={selectedRanking} onNotice={notify} /></section></main>;
}
