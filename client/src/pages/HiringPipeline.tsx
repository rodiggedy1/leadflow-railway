/**
 * HiringPipeline — Cleaner hiring pipeline UI
 * Pixel-perfect match to the provided design screenshots.
 * Data is static/mock for now; will be wired to backend in a future phase.
 */
import React, { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  User,
  MessageSquare,
  Phone,
  CheckCircle2,
  Search,
  ChevronRight,
  Car,
  Calendar,
  MapPin,
  Shield,
  Zap,
  Filter,
  XCircle,
  Clock,
  Star,
  Play,
  Pause,
  Video,
  FileText,
  X,
  CheckCircle,
  XCircle as XCircleIcon,
  Minus,
  Mail,
  Phone as PhoneIcon,
  MapPin as MapPinIcon,
  Briefcase,
  Bot,
  ExternalLink,
  Trash2,
  Archive,
  MoreVertical,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage =
  | "Application Submitted"
  | "AI Interview"
  | "Real Interview"
  | "Background Check"
  | "Paid Test Clean"
  | "Onboarding"
  | "Active";

interface Candidate {
  id: number;
  initials: string;
  name: string;
  subtitle: string;
  transport: "Car" | "No car" | "Transit";
  zip: string;
  stage: Stage;
  score: number;
  tag?: string;
  availability?: string;
  aiScore?: number | null;
  aiSummary?: string;
  scores?: {
    communication: number;
    reliability: number;
    quality: number;
    professionalism: number;
  };
  checklistStatus?: {
    applicationSubmitted: "done" | "pending" | "in-progress";
    aiInterviewStarted: "done" | "pending" | "in-progress";
    aiInterviewCompleted: "done" | "pending" | "in-progress";
    nudgeScheduled: "done" | "pending" | "in-progress";
  };
  notes?: string[];
  videoUrl?: string;
  interviewVideoUrl?: string;
  bioPhotoUrl?: string;
  // Full application data
  phone?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  hasCleaning?: boolean | null;
  hasBankAccount?: boolean | null;
  isAuthorized?: boolean | null;
  consentBackground?: boolean | null;
  experience?: string;
  specialtiesList?: string[];
}

// ── Mock data removed — only real DB candidates are shown ───────────────────

const MOCK_CANDIDATES: Candidate[] = [];

const STAGES: Stage[] = [
  "Application Submitted",
  "AI Interview",
  "Real Interview",
  "Background Check",
  "Paid Test Clean",
  "Onboarding",
  "Active",
];

// Badge color per stage — matches the screenshot's colored dots
const STAGE_BADGE: Record<Stage, { bg: string; text: string }> = {
  "Application Submitted": { bg: "#e0e7ff", text: "#4f46e5" },
  "AI Interview":          { bg: "#ede9fe", text: "#7c3aed" },
  "Real Interview":        { bg: "#dbeafe", text: "#2563eb" },
  "Background Check":      { bg: "#fef3c7", text: "#d97706" },
  "Paid Test Clean":       { bg: "#fee2e2", text: "#dc2626" },
  "Onboarding":            { bg: "#d1fae5", text: "#059669" },
  "Active":                { bg: "#dcfce7", text: "#16a34a" },
};

const AUTOMATIONS = [
  { icon: <MessageSquare className="w-4 h-4 text-purple-500" />, title: "AI interview nudge", desc: "15 min after apply if not started", status: "Live" },
  { icon: <Zap className="w-4 h-4 text-blue-500" />, title: "Fast-track interview link", desc: "Auto-send to A players over 80", status: "Live" },
  { icon: <Shield className="w-4 h-4 text-amber-500" />, title: "Background check request", desc: "Triggered after passing real interview", status: "Live" },
  { icon: <Star className="w-4 h-4 text-orange-400" />, title: "Paid test clean reminders", desc: "24h and 1h before scheduled clean", status: "Live" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Strong", color: "#059669" };
  if (score >= 60) return { label: "Watch", color: "#d97706" };
  return { label: "Flag", color: "#dc2626" };
}

function ChecklistIcon({ status }: { status: "done" | "pending" | "in-progress" }) {
  if (status === "done") return <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />;
  if (status === "in-progress") return <Clock className="w-5 h-5" style={{ color: "#f59e0b" }} />;
  return <CheckCircle2 className="w-5 h-5 text-gray-200" />;
}

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
      <div className="h-full rounded-full bg-gray-900" style={{ width: `${value}%` }} />
    </div>
  );
}

// ── Candidate Card (inside a stage column) ────────────────────────────────────

function CandidateCard({
  candidate,
  isSelected,
  onClick,
  isDragOverlay,
  onArchive,
  onDelete,
}: {
  candidate: Candidate;
  isSelected: boolean;
  onClick: () => void;
  isDragOverlay?: boolean;
  onArchive?: (id: number) => void;
  onDelete?: (id: number) => void;
}) {
  const hasTransport = candidate.transport !== "No car";
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: candidate.id,
    data: { candidate },
    disabled: isDragOverlay,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className="rounded-2xl transition-all"
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? "grabbing" : "grab",
        backgroundColor: "#ffffff",
        border: isSelected ? "1.5px solid #0f172a" : "1px solid #e8ecf0",
        boxShadow: isDragOverlay
          ? "0 8px 24px rgba(0,0,0,0.15)"
          : isSelected
          ? "0 0 0 1px #0f172a"
          : "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.04)",
        padding: "14px 16px 12px",
      }}
    >
      {/* Name row */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 overflow-hidden"
          style={{ backgroundColor: "#edf0f4", color: "#64748b", fontSize: "12px", letterSpacing: "0.02em", border: "1px solid #e2e8f0" }}
        >
          {candidate.bioPhotoUrl
            ? <img src={candidate.bioPhotoUrl} alt={candidate.name} className="w-full h-full object-cover" />
            : candidate.initials
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className="font-bold leading-snug truncate"
              style={{ fontSize: "15px", color: "#0f172a" }}
            >
              {candidate.name}
            </span>
            {/* Action menu — stops propagation so card click doesn't fire */}
            <div ref={menuRef} className="relative" onClick={e => e.stopPropagation()}>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
                className="p-0.5 rounded hover:bg-slate-100 transition-colors"
                style={{ color: "#94a3b8" }}
                aria-label="Candidate actions"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-6 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[130px]"
                  style={{ fontSize: "13px" }}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-slate-700 transition-colors"
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); onArchive?.(candidate.id); }}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-red-600 transition-colors"
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete?.(candidate.id); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: "#94a3b8" }}>
            {candidate.subtitle}
          </p>
        </div>
      </div>

      {/* Pills row */}
      <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
        {hasTransport && (
          <span
            className="inline-flex items-center gap-1 rounded-full border"
            style={{
              borderColor: "#e2e8f0",
              backgroundColor: "#f8fafc",
              color: "#475569",
              fontSize: "12px",
              fontWeight: 500,
              padding: "3px 10px 3px 8px",
              lineHeight: 1.4,
            }}
          >
            <Car style={{ width: 12, height: 12, strokeWidth: 1.8 }} />
            Car
          </span>
        )}
        {!hasTransport && (
          <span
            className="inline-flex items-center gap-1 rounded-full border"
            style={{
              borderColor: "#e2e8f0",
              backgroundColor: "#f8fafc",
              color: "#475569",
              fontSize: "12px",
              fontWeight: 500,
              padding: "3px 10px 3px 8px",
              lineHeight: 1.4,
            }}
          >
            <Car style={{ width: 12, height: 12, strokeWidth: 1.8 }} />
            No car
          </span>
        )}
        <span
          className="inline-flex items-center rounded-full border"
          style={{
            borderColor: "#e2e8f0",
            backgroundColor: "#f8fafc",
            color: "#475569",
            fontSize: "12px",
            fontWeight: 500,
            padding: "3px 10px",
            lineHeight: 1.4,
          }}
        >
          ZIP {candidate.zip}
        </span>
      </div>

      {/* Tag + Score row */}
      <div className="flex items-center justify-between mt-2.5">
        {candidate.tag ? (
          <span style={{ fontSize: "12px", color: "#94a3b8" }}>{candidate.tag}</span>
        ) : (
          <span />
        )}
        {candidate.aiScore != null ? (
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#fff",
              backgroundColor: candidate.aiScore >= 80 ? "#059669" : candidate.aiScore >= 60 ? "#d97706" : "#dc2626",
              borderRadius: "999px",
              padding: "2px 9px",
            }}
          >
            AI {candidate.aiScore}
          </span>
        ) : (
          <span style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}>Scoring…</span>
        )}
      </div>
    </div>
  );
}

// ── Stage Card (the large rounded container) ──────────────────────────────────

function StageCard({
  stage,
  candidates,
  selectedId,
  onSelect,
  onArchive,
  onDelete,
}: {
  stage: Stage;
  candidates: Candidate[];
  selectedId: number | null;
  onSelect: (c: Candidate) => void;
  onArchive?: (id: number) => void;
  onDelete?: (id: number) => void;
}) {
  const badge = STAGE_BADGE[stage];
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div
      ref={setNodeRef}
      className="rounded-3xl transition-colors"
      style={{
        backgroundColor: isOver ? "#eef2ff" : "#f7f9fb",
        border: isOver ? "1.5px dashed #6366f1" : "1px solid #eaecf0",
        padding: "20px 18px 18px",
      }}
    >
      {/* Stage header */}
      <div className="flex items-start justify-between" style={{ marginBottom: 4 }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a", lineHeight: 1.3 }}>
            {stage}
          </p>
          <p style={{ fontSize: "13px", color: "#94a3b8", marginTop: 2 }}>
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
          </p>
        </div>
        <span
          className="flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 28,
            height: 28,
            backgroundColor: badge.bg,
            color: badge.text,
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          {candidates.length}
        </span>
      </div>

      {/* Candidate cards */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {candidates.length === 0 ? (
          <div
            className="rounded-xl text-center"
            style={{
              border: "1px dashed #dde1e7",
              padding: "18px 12px",
              fontSize: "13px",
              color: "#c0c8d2",
            }}
          >
            No candidates here.
          </div>
        ) : (
          candidates.map(c => (
            <CandidateCard
              key={c.id}
              candidate={c}
              isSelected={selectedId === c.id}
              onClick={() => onSelect(c)}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Video Interview Card ─────────────────────────────────────────────────────

function VideoInterviewCard({ videoUrl }: { videoUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  if (!showPlayer) {
    return (
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid #e2e8f0" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
            >
              <Video size={13} color="#fff" />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>Application Video</span>
          </div>
          <span
            className="rounded-full"
            style={{ fontSize: 11, fontWeight: 600, color: "#7c3aed", backgroundColor: "#f5f3ff", padding: "3px 10px" }}
          >
            Recorded
          </span>
        </div>

        {/* Thumbnail / play button */}
        <div
          className="relative flex items-center justify-center cursor-pointer group"
          style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)", aspectRatio: "16/9" }}
          onClick={() => setShowPlayer(true)}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
            style={{ backgroundColor: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)" }}
          >
            <Play size={24} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
          </div>
          <p style={{ position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            Click to watch application video
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid #e2e8f0" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
          >
            <Video size={13} color="#fff" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>Application Video</span>
        </div>
        <button
          onClick={togglePlay}
          className="flex items-center gap-1.5 rounded-lg transition-colors hover:bg-gray-100"
          style={{ fontSize: 12, fontWeight: 500, color: "#7c3aed", padding: "4px 10px" }}
        >
          {isPlaying ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Play</>}
        </button>
      </div>

      {/* Video player */}
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full"
        style={{ display: "block", backgroundColor: "#0f0f1a", maxHeight: 260 }}
        controls
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        playsInline
      />
    </div>
  );
}

// ── Interview Recording Card ─────────────────────────────────────────────────
// Distinct from VideoInterviewCard (application form video) — this shows the
// camera recording captured during the VAPI AI interview session.
function InterviewRecordingCard({ videoUrl, candidateId }: { videoUrl: string; candidateId: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);

  const recordingQuery = trpc.hiring.getInterviewRecordingUrl.useQuery(
    { candidateId },
    { enabled: showPlayer, retry: false, staleTime: 5 * 60 * 1000 }
  );
  const audioUrl = recordingQuery.data?.recordingUrl ?? null;
  const isStereo = recordingQuery.data?.isStereo ?? false;

  const togglePlay = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (v.paused) {
      // Sync audio to video position then play both
      if (a) { a.currentTime = v.currentTime; a.play().catch(() => {}); }
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      if (a) a.pause();
      setIsPlaying(false);
    }
  };

  // Keep audio in sync when video is seeked
  const handleVideoSeeked = () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (v && a) a.currentTime = v.currentTime;
  };

  if (!showPlayer) {
    return (
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
        <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0f766e, #0d9488)" }}>
              <Video size={13} color="#fff" />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>AI Interview</span>
          </div>
          <span className="rounded-full" style={{ fontSize: 11, fontWeight: 600, color: "#0f766e", backgroundColor: "#f0fdfa", padding: "3px 10px" }}>
            AI Interview
          </span>
        </div>
        <div
          className="relative flex items-center justify-center cursor-pointer group"
          style={{ background: "linear-gradient(135deg, #042f2e 0%, #134e4a 100%)", aspectRatio: "16/9" }}
          onClick={() => setShowPlayer(true)}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
            style={{ backgroundColor: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)" }}
          >
            <Play size={24} color="#fff" fill="#fff" style={{ marginLeft: 3 }} />
          </div>
          <p style={{ position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            Click to watch AI interview
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
      <div className="flex items-center justify-between" style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0f766e, #0d9488)" }}>
            <Video size={13} color="#fff" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>AI Interview</span>
          {audioUrl && (
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>+ AI audio</span>
          )}
        </div>
        <button
          onClick={togglePlay}
          className="flex items-center gap-1.5 rounded-lg transition-colors hover:bg-gray-100"
          style={{ fontSize: 12, fontWeight: 500, color: "#0f766e", padding: "4px 10px" }}
        >
          {isPlaying ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Play</>}
        </button>
      </div>
      {/* Hidden audio element plays VAPI call recording in sync with the video */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          style={{ display: "none" }}
          onEnded={() => { videoRef.current?.pause(); setIsPlaying(false); }}
        />
      )}
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full"
        style={{ display: "block", backgroundColor: "#042f2e", maxHeight: 260 }}
        onPlay={() => {
          if (audioRef.current) { audioRef.current.currentTime = videoRef.current?.currentTime ?? 0; audioRef.current.play().catch(() => {}); }
          setIsPlaying(true);
        }}
        onPause={() => { audioRef.current?.pause(); setIsPlaying(false); }}
        onEnded={() => { audioRef.current?.pause(); setIsPlaying(false); }}
        onSeeked={handleVideoSeeked}
        playsInline
        controls
      />
    </div>
  );
}

// ── Application Details Modal ───────────────────────────────────────────────

function AnswerBadge({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full" style={{ backgroundColor: "#f1f5f9", color: "#94a3b8", fontSize: 12, fontWeight: 600, padding: "3px 10px" }}>
        <Minus size={11} /> Not answered
      </span>
    );
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full" style={{ backgroundColor: "#dcfce7", color: "#16a34a", fontSize: 12, fontWeight: 600, padding: "3px 10px" }}>
        <CheckCircle size={11} /> Yes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full" style={{ backgroundColor: "#fee2e2", color: "#dc2626", fontSize: 12, fontWeight: 600, padding: "3px 10px" }}>
      <XCircleIcon size={11} /> No
    </span>
  );
}

function ApplicationDetailsModal({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      onClick={handleBackdrop}
    >
      <div
        className="relative rounded-3xl overflow-y-auto"
        style={{
          backgroundColor: "#fff",
          width: "min(640px, 95vw)",
          maxHeight: "88vh",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          padding: "28px 28px 32px",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100"
          style={{ color: "#64748b" }}
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="rounded-full overflow-hidden shrink-0 flex items-center justify-center font-semibold"
            style={{ width: 64, height: 64, backgroundColor: "#f1f5f9", color: "#64748b", fontSize: 18, border: "1px solid #e2e8f0" }}
          >
            {candidate.bioPhotoUrl
              ? <img src={candidate.bioPhotoUrl} alt={candidate.name} className="w-full h-full object-cover" />
              : candidate.initials
            }
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", lineHeight: 1.2 }}>{candidate.name}</h2>
            <p style={{ fontSize: 13, color: "#64748b", marginTop: 3 }}>Application Details</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Contact Info */}
          <section>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Contact Information</p>
            <div className="grid grid-cols-2 gap-3">
              {candidate.phone && (
                <div className="flex items-center gap-2.5 rounded-2xl" style={{ border: "1px solid #e2e8f0", padding: "10px 14px" }}>
                  <PhoneIcon size={14} style={{ color: "#7c3aed", flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>Phone</p>
                    <p style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>{candidate.phone}</p>
                  </div>
                </div>
              )}
              {candidate.email && (
                <div className="flex items-center gap-2.5 rounded-2xl" style={{ border: "1px solid #e2e8f0", padding: "10px 14px" }}>
                  <Mail size={14} style={{ color: "#7c3aed", flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>Email</p>
                    <p style={{ fontSize: 13, color: "#0f172a", fontWeight: 600, wordBreak: "break-all" }}>{candidate.email}</p>
                  </div>
                </div>
              )}
              {(candidate.city || candidate.state) && (
                <div className="flex items-center gap-2.5 rounded-2xl col-span-2" style={{ border: "1px solid #e2e8f0", padding: "10px 14px" }}>
                  <MapPinIcon size={14} style={{ color: "#7c3aed", flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>Address</p>
                    <p style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>
                      {[candidate.streetAddress, candidate.city, candidate.state, candidate.zip].filter(Boolean).join(", ")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Requirements */}
          <section>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Eligibility Questions</p>
            <div className="space-y-2">
              {([
                ["Has cleaning experience", candidate.hasCleaning],
                ["Has a bank account", candidate.hasBankAccount],
                ["Authorized to work in the US", candidate.isAuthorized],
                ["Consents to background check", candidate.consentBackground],
              ] as [string, boolean | null | undefined][]).map(([label, val]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl" style={{ border: "1px solid #e2e8f0", padding: "10px 14px" }}>
                  <span style={{ fontSize: 13, color: "#0f172a" }}>{label}</span>
                  <AnswerBadge value={val} />
                </div>
              ))}
            </div>
          </section>

          {/* Specialties */}
          {candidate.specialtiesList && candidate.specialtiesList.length > 0 && (
            <section>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Specialties</p>
              <div className="flex flex-wrap gap-2">
                {candidate.specialtiesList.map(s => (
                  <span key={s} className="rounded-full" style={{ backgroundColor: "#f5f3ff", color: "#7c3aed", fontSize: 12, fontWeight: 600, padding: "4px 12px" }}>{s}</span>
                ))}
              </div>
            </section>
          )}

          {/* Experience / Bio */}
          {candidate.experience && (
            <section>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Experience &amp; Background</p>
              <div className="rounded-2xl" style={{ border: "1px solid #e2e8f0", padding: "14px 16px" }}>
                <div className="flex items-start gap-2">
                  <Briefcase size={14} style={{ color: "#7c3aed", marginTop: 2, flexShrink: 0 }} />
                  <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.65 }}>{candidate.experience}</p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Candidate Detail Panel ────────────────────────────────────────────────────

function CandidateDetail({ candidate, onScoreUpdated }: { candidate: Candidate | null; onScoreUpdated?: () => void }) {
  const [editableNotes, setEditableNotes] = React.useState<string[]>(candidate?.notes ?? []);
  const [showAppModal, setShowAppModal] = React.useState(false);
  const utils = trpc.useUtils();
  const rescoreMutation = trpc.hiring.rescoreCandidate.useMutation({
    onSuccess: () => {
      utils.hiring.getCandidates.invalidate();
      onScoreUpdated?.();
    },
  });

  React.useEffect(() => {
    setEditableNotes(candidate?.notes ?? []);
    setShowAppModal(false);
  }, [candidate?.id]);

  if (!candidate) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-sm">
        <User className="w-8 h-8 mb-2 opacity-30" />
        Click any candidate to inspect the workflow.
      </div>
    );
  }

  const cl = candidate.checklistStatus;
  const sc = candidate.scores;
  const badge = STAGE_BADGE[candidate.stage];

  return (
    <div className="space-y-5">
      {/* Header: name + score badge + stage badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="rounded-full flex items-center justify-center font-semibold shrink-0 overflow-hidden"
            style={{ width: 56, height: 56, backgroundColor: "#f1f5f9", color: "#64748b", fontSize: 15, border: "1px solid #e2e8f0" }}
          >
            {candidate.bioPhotoUrl
              ? <img src={candidate.bioPhotoUrl} alt={candidate.name} className="w-full h-full object-cover" />
              : candidate.initials
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 style={{ fontSize: 20, fontWeight: 600, color: "#0f172a", lineHeight: 1.2 }}>
                {candidate.name}
              </h3>
              {candidate.aiScore != null ? (
                <span
                  className="rounded-full text-white"
                  style={{
                    backgroundColor: candidate.aiScore >= 80 ? "#059669" : candidate.aiScore >= 60 ? "#d97706" : "#dc2626",
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "3px 12px",
                  }}
                >
                  AI Score {candidate.aiScore}/100
                </span>
              ) : (
                <span
                  className="rounded-full"
                  style={{ backgroundColor: "#f1f5f9", color: "#94a3b8", fontSize: 12, fontWeight: 500, padding: "3px 12px" }}
                >
                  Scoring…
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-1.5" style={{ fontSize: 13, color: "#64748b" }}>
              <span className="inline-flex items-center gap-1">
                <Car style={{ width: 14, height: 14 }} />
                {candidate.transport}
              </span>
              {candidate.availability && (
                <span className="inline-flex items-center gap-1">
                  <Calendar style={{ width: 14, height: 14 }} />
                  {candidate.availability}
                </span>
              )}
              <span>ZIP {candidate.zip}</span>
            </div>
          </div>
        </div>
        <span
          className="rounded-full border shrink-0"
          style={{
            backgroundColor: badge.bg,
            color: badge.text,
            borderColor: badge.bg,
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 12px",
            whiteSpace: "nowrap",
          }}
        >
          {candidate.stage}
        </span>
      </div>

      {/* Action buttons row */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowAppModal(true)}
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl transition-colors hover:bg-slate-100"
          style={{ border: "1px solid #e2e8f0", padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "#0f172a", backgroundColor: "#f8fafc" }}
        >
          <FileText size={15} />
          View Application
        </button>
        {candidate.id < 10000 ? (
          <a
            href={`/interview/${candidate.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl transition-colors hover:opacity-90"
            style={{ border: "1px solid #6366f1", padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "#fff", backgroundColor: "#6366f1", textDecoration: "none" }}
          >
            <Bot size={15} />
            AI Interview
            <ExternalLink size={12} />
          </a>
        ) : (
          <div
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl"
            style={{ border: "1px solid #e2e8f0", padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "#94a3b8", backgroundColor: "#f8fafc", cursor: "not-allowed" }}
            title="AI Interview is only available for real applicants submitted via the /apply form"
          >
            <Bot size={15} />
            AI Interview
          </div>
        )}
      </div>

      {/* Application Details Modal */}
      {showAppModal && (
        <ApplicationDetailsModal candidate={candidate} onClose={() => setShowAppModal(false)} />
      )}

      {/* Application Video — plays the applicant's recorded answer from the form */}
      {candidate.videoUrl && (
        <VideoInterviewCard videoUrl={candidate.videoUrl} />
      )}

      {/* Interview Recording — VAPI camera recording from the AI interview */}
      {candidate.interviewVideoUrl && (
        <InterviewRecordingCard videoUrl={candidate.interviewVideoUrl} candidateId={candidate.id} />
      )}

      {/* AI Summary — soft bordered card */}
      <div
        className="rounded-2xl"
        style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", padding: "14px 16px" }}
      >
        <div className="flex items-center justify-between mb-2">
          <p style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>AI Summary</p>
          <button
            onClick={() => candidate.id && rescoreMutation.mutate({ id: candidate.id })}
            disabled={rescoreMutation.isPending}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: rescoreMutation.isPending ? "#94a3b8" : "#6366f1",
              background: "none",
              border: "none",
              cursor: rescoreMutation.isPending ? "not-allowed" : "pointer",
              padding: "2px 6px",
              borderRadius: 6,
            }}
          >
            {rescoreMutation.isPending ? "Scoring…" : "↻ Re-score"}
          </button>
        </div>
        {candidate.aiSummary ? (
          <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.65 }}>{candidate.aiSummary}</p>
        ) : (
          <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>
            {rescoreMutation.isPending ? "Generating AI score…" : "No AI summary yet. Click ↻ Re-score to generate one."}
          </p>
        )}
      </div>

      {/* Metric score boxes — 2-col grid, each in a soft bordered card */}
      {sc && (
        <div className="grid grid-cols-2 gap-3">
          {([
            ["Communication", sc.communication],
            ["Reliability", sc.reliability],
            ["Quality", sc.quality],
            ["Professionalism", sc.professionalism],
          ] as [string, number][]).map(([label, value]) => {
            const { label: lbl } = scoreLabel(value);
            return (
              <div
                key={label}
                className="rounded-2xl"
                style={{ border: "1px solid #e2e8f0", padding: "12px 14px" }}
              >
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: "#64748b" }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{lbl}</span>
                </div>
                <ScoreBar value={value} />
                <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{value}/100</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Pipeline checklist — each row in its own bordered card */}
      {cl && (
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 10 }}>Pipeline checklist</p>
          <div className="space-y-2">
            {([
              ["Application submitted", cl.applicationSubmitted],
              ["AI interview started", cl.aiInterviewStarted],
              ["AI interview completed", cl.aiInterviewCompleted],
              ["Nudge scheduled", cl.nudgeScheduled],
            ] as [string, "done" | "pending" | "in-progress"][]).map(([label, status]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-2xl"
                style={{ border: "1px solid #e2e8f0", padding: "10px 14px" }}
              >
                <span style={{ fontSize: 14, color: "#0f172a" }}>{label}</span>
                <ChecklistIcon status={status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interviewer notes — each note in its own bordered card */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginBottom: 10 }}>Interviewer notes</p>
        <div className="space-y-2">
          {(editableNotes.length > 0 ? editableNotes : [""]).map((note, i) => (
            <div
              key={i}
              className="rounded-2xl"
              style={{ border: "1px solid #e2e8f0", backgroundColor: "#ffffff", padding: "10px 14px" }}
            >
              <input
                type="text"
                value={note}
                onChange={e => {
                  const updated = [...editableNotes];
                  updated[i] = e.target.value;
                  setEditableNotes(updated);
                }}
                placeholder="Add a note…"
                className="w-full bg-transparent outline-none"
                style={{ fontSize: 13, color: "#475569" }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <button
          className="h-11 rounded-2xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#0f172a" }}
        >
          Advance stage
        </button>
        <button
          className="h-11 rounded-2xl text-sm font-semibold border transition-colors hover:bg-slate-50"
          style={{ borderColor: "#e2e8f0", color: "#374151", backgroundColor: "#fff" }}
        >
          Send message
        </button>
        <button
          className="h-11 rounded-2xl text-sm font-semibold border transition-colors hover:bg-slate-50"
          style={{ borderColor: "#e2e8f0", color: "#374151", backgroundColor: "#fff" }}
        >
          Book interview
        </button>
        <button
          className="h-11 rounded-2xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#ef4444" }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

const FILTER_TABS = [
  "All",
  "Application Submitted",
  "AI Interview",
  "Real Interview",
  "Background Check",
  "Paid Test Clean",
  "Onboarding",
  "Active",
] as const;
type FilterTab = (typeof FILTER_TABS)[number];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HiringPipeline() {
  const [filterTab, setFilterTab] = useState<FilterTab>("All");
  const [search, setSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<Candidate | null>(null);
  // Optimistic stage overrides: candidateId -> new stage
  const [stageOverrides, setStageOverrides] = useState<Record<number, Stage>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const updateStageMutation = trpc.hiring.updateStage.useMutation({
    onSuccess: () => candidatesQuery.refetch(),
    onError: (_err, vars) => {
      // Roll back optimistic update on error
      setStageOverrides(prev => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
    },
  });

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // SMS confirmation popup state
  const [smsPending, setSmsPending] = useState<{ id: number; name: string; stage: Stage } | null>(null);
  // Stages that trigger an SMS confirmation popup
  const SMS_STAGES: Stage[] = ["Real Interview", "Background Check", "Paid Test Clean", "Onboarding"];
  const deleteCandidateMutation = trpc.hiring.deleteCandidate.useMutation({
    onSuccess: () => {
      setSelectedCandidate(null);
      setConfirmDeleteId(null);
      candidatesQuery.refetch();
    },
  });

  const archiveCandidateMutation = trpc.hiring.archiveCandidate.useMutation({
    onSuccess: () => {
      setSelectedCandidate(null);
      candidatesQuery.refetch();
    },
  });

  function handleDragStart(event: DragStartEvent) {
    const candidate = event.active.data.current?.candidate as Candidate | undefined;
    setActiveCandidate(candidate ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCandidate(null);
    const { active, over } = event;
    if (!over) return;
    const candidate = active.data.current?.candidate as Candidate | undefined;
    if (!candidate) return;
    const newStage = over.id as Stage;
    if (newStage === candidate.stage) return;
    // Only DB candidates (id < 10000) can be moved
    if (candidate.id >= 10000) return;
    // Optimistic update
    setStageOverrides(prev => ({ ...prev, [candidate.id]: newStage }));
    // If this stage has an SMS notification, show the confirmation popup
    if (SMS_STAGES.includes(newStage) && candidate.phone) {
      setSmsPending({ id: candidate.id, name: candidate.name.split(" ")[0] ?? candidate.name, stage: newStage });
      updateStageMutation.mutate({ id: candidate.id, stage: newStage, sendSmsNotification: false });
    } else {
      updateStageMutation.mutate({ id: candidate.id, stage: newStage });
    }
  }

  const candidatesQuery = trpc.hiring.getCandidates.useQuery(undefined, {
    // Poll more frequently when any candidate is still awaiting AI scoring
    refetchInterval: (query) => {
      const rows: any[] = (query.state.data as any[]) ?? [];
      const hasPending = rows.some((r: any) => r.aiScore == null);
      return hasPending ? 8_000 : 30_000;
    },
    // Always treat data as stale so switching back to the tab triggers a refetch
    staleTime: 0,
    refetchOnWindowFocus: true,
    // Keep showing previous data during background refetch — prevents cards from
    // flashing out momentarily while a new fetch is in flight
    placeholderData: (prev) => prev,
  });

  // Merge real DB candidates with mock data, applying optimistic stage overrides
  const allCandidates: Candidate[] = useMemo(() => {
    const dbRows = candidatesQuery.data ?? [];
    const dbCandidates: Candidate[] = dbRows.map(r => ({
      id: r.id,
      initials: `${r.firstName[0] ?? "?"}${r.lastName[0] ?? "?"}`.toUpperCase(),
      name: `${r.firstName} ${r.lastName}`.trim(),
      subtitle: r.specialties?.length ? r.specialties.slice(0, 2).join(", ") : "New applicant",
      transport: "Car" as const,
      zip: r.zip ?? "—",
      stage: (r.stage as Stage) ?? "Application Submitted",
      score: r.aiScore ?? 0,
      aiScore: r.aiScore ?? null,
      aiSummary: r.aiSummary ?? r.experience ?? undefined,
      notes: [],
      videoUrl: r.videoUrl ?? undefined,
      interviewVideoUrl: r.interviewVideoUrl ?? undefined,
      bioPhotoUrl: r.bioPhotoUrl ?? undefined,
      phone: r.phone,
      email: r.email ?? undefined,
      streetAddress: r.streetAddress ?? undefined,
      city: r.city ?? undefined,
      state: r.state ?? undefined,
      hasCleaning: r.hasCleaning,
      hasBankAccount: r.hasBankAccount,
      isAuthorized: r.isAuthorized,
      consentBackground: r.consentBackground,
      experience: r.experience ?? undefined,
      specialtiesList: r.specialties ?? [],
    }));
    // Prepend real DB candidates before mock ones
    const merged = [...dbCandidates];
    // Apply optimistic stage overrides
    return merged.map(c =>
      stageOverrides[c.id] ? { ...c, stage: stageOverrides[c.id] } : c
    );
  }, [candidatesQuery.data, stageOverrides]);

  const filteredCandidates = allCandidates.filter(c => {
    const matchesTab = filterTab === "All" || c.stage === filterTab;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.zip.includes(q) ||
      c.subtitle.toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  const visibleStages: Stage[] =
    filterTab === "All" ? STAGES : ([filterTab] as Stage[]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f8fafc", fontFamily: "Inter, sans-serif" }}>
      <AdminHeader activeTab="hiring" />
      {/* ── Top header ── */}
      <div className="px-6 pt-8 pb-4" style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
        <div className="max-w-[1400px] mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
              style={{ borderColor: "#e5e7eb", color: "#6b7280", backgroundColor: "#f9fafb" }}
            >
              <Zap className="w-3 h-3" /> Hiring OS
            </span>
          </div>

          {/* Title row */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Cleaner hiring pipeline</h1>
              <p className="text-sm text-gray-500 mt-1 max-w-xl">
                A fast, filter-heavy flow for contractor hiring: application → AI interview → real interview → trust check →
                paid test clean → onboarding.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search candidates, zip, experience…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-gray-200 transition-all"
                  style={{ borderColor: "#e5e7eb", width: 280, backgroundColor: "#f9fafb" }}
                />
              </div>
              <button
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#0f172a" }}
              >
                Re-engage drop-offs
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[
              { label: "Applications today", value: "38", sub: "+18% from yesterday", icon: <User className="w-5 h-5 text-gray-400" /> },
              { label: "AI interviews completed", value: "22", sub: "58% completion rate", icon: <MessageSquare className="w-5 h-5 text-gray-400" /> },
              { label: "Interviews in motion", value: "4", sub: "3 scheduled today", icon: <Phone className="w-5 h-5 text-gray-400" /> },
              { label: "Hires this week", value: "4", sub: "2 pending onboarding", icon: <CheckCircle2 className="w-5 h-5 text-gray-400" /> },
            ].map(({ label, value, sub, icon }) => (
              <div
                key={label}
                className="rounded-2xl border p-4"
                style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="text-3xl font-extrabold text-gray-900 mt-1">{value}</p>
                    <p className="text-xs text-gray-400 mt-1">{sub}</p>
                  </div>
                  <div className="mt-1">{icon}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body: Pipeline board + Detail panel ── */}
      <div className="max-w-[1400px] mx-auto px-6 py-6 flex gap-6 items-start">

        {/* ── Pipeline board ── */}
        <div
          className="flex-1 rounded-2xl border p-6 min-w-0"
          style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
        >
          {/* Board header row */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-1">
            <div className="shrink-0">
              <h2 className="text-xl font-bold text-gray-900">Pipeline board</h2>
              <p className="text-sm text-gray-400 mt-0.5 max-w-[180px] leading-snug">
                Click any lane or candidate to inspect the workflow.
              </p>
            </div>

            {/* Filter pill tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-wrap">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-all"
                  style={
                    filterTab === tab
                      ? { backgroundColor: "#0f172a", color: "#ffffff", borderColor: "#0f172a" }
                      : { backgroundColor: "#ffffff", color: "#374151", borderColor: "#e5e7eb" }
                  }
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Scroll indicator bar */}
          <div className="mt-3 mb-5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#f1f5f9" }}>
            <div className="h-full w-1/3 rounded-full" style={{ backgroundColor: "#cbd5e1" }} />
          </div>

          {/* 2-column grid of stage cards — wrapped in DndContext for drag-and-drop */}
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-2 gap-4">
              {visibleStages.map(stage => (
                <StageCard
                  key={stage}
                  stage={stage}
                  candidates={filteredCandidates.filter(c => c.stage === stage)}
                  selectedId={selectedCandidate?.id ?? null}
                  onSelect={c => setSelectedCandidate(c)}
                  onArchive={id => archiveCandidateMutation.mutate({ id, archived: true })}
                  onDelete={id => setConfirmDeleteId(id)}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeCandidate ? (
                <CandidateCard
                  candidate={activeCandidate}
                  isSelected={false}
                  onClick={() => {}}
                  isDragOverlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* ── Right panel ── */}
        <div className="w-[420px] shrink-0 space-y-4">
          {/* Candidate detail */}
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Candidate detail</h2>
                <p className="text-xs text-gray-400">Click around the board to switch profiles.</p>
              </div>
              {selectedCandidate && (
                confirmDeleteId === selectedCandidate.id ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500">Delete?</span>
                    <button
                      onClick={() => deleteCandidateMutation.mutate({ id: selectedCandidate.id })}
                      disabled={deleteCandidateMutation.isPending}
                      className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors"
                    >
                      {deleteCandidateMutation.isPending ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(selectedCandidate.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                    title="Delete candidate"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )
              )}
            </div>
            <CandidateDetail candidate={selectedCandidate} />
          </div>

          {/* Automations */}
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-3">Automations</h2>
            <div className="space-y-3">
              {AUTOMATIONS.map(a => (
                <div key={a.title} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "#f8fafc" }}
                  >
                    {a.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                    <p className="text-xs text-gray-400 truncate">{a.desc}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-500 shrink-0">{a.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Decision rules */}
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-3">Decision rules</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#10b981" }} />
                <p className="text-sm text-gray-700">
                  <strong>80+ score:</strong> send interview booking instantly.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <Filter className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                <p className="text-sm text-gray-700">
                  <strong>60–79:</strong> hold for manager review or batch interview.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                <p className="text-sm text-gray-700">
                  <strong>Below 60:</strong> reject or save as backup pool.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── SMS Confirmation Popup ── */}
      {smsPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Send SMS to {smsPending.name}?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Notify them about moving to <span className="font-semibold text-slate-700">{smsPending.stage}</span>.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  updateStageMutation.mutate({ id: smsPending.id, stage: smsPending.stage, sendSmsNotification: true });
                  setSmsPending(null);
                }}
                className="flex-1 bg-[#E8735A] hover:bg-[#d4614a] text-white font-semibold text-sm rounded-xl py-2.5 transition-colors"
              >
                Yes, send SMS
              </button>
              <button
                onClick={() => setSmsPending(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl py-2.5 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
