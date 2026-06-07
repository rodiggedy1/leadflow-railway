import React from 'react';
import { createPortal } from 'react-dom';
/**
 * SchedulingTab.tsx
 * Geographic route optimization UI for cleaning teams.
 *
 * Layout:
 *   Left panel  — Date picker + team legend + per-team job lists with drag handles
 *   Right panel — Google Map with color-coded polylines per team + job markers
 *   Top bar     — Optimize button, team management sheet
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { MapView } from "@/components/Map";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Sparkles, Settings2, ChevronLeft, ChevronRight, MapPin,
  Clock, Users, Plus, Pencil, Trash2, Home, Loader2, AlertCircle,
  GripVertical, RotateCcw, Lock, Unlock, X, ArrowDown, ArrowUp, Timer,
  SlidersHorizontal, Power, AlertTriangle, Phone,
} from "lucide-react";
import IssueDialog from "@/components/IssueDialog";
import CallLogPanel from "@/components/CallLogPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Team {
  id: number;
  name: string;
  homeAddress: string | null;
  homeLat: number | null;
  homeLng: number | null;
  maxHoursPerDay: number | null;
  color: string | null;
  isActive: number;
  minJobs?: number | null;
  maxJobs?: number | null;
  earliestStartTime?: string | null;
  homeDriveTimeSecs?: number | null;
  avgRating?: number | null;
  ratingCount?: number;
  tag?: string | null;
  regionTags?: string | null; // comma-separated, e.g. "DC,MD"
}

interface Job {
  id: number;
  jobDate: string;
  customerName: string | null;
  jobAddress: string | null;
  serviceType: string | null;
  serviceDateTime: string | null;
  teamName: string | null;
  bookingStatus: string | null;
  frequency?: string | null;
  isNewClient?: boolean;
  isMoveInOut?: boolean;
  isRecurring?: boolean;
  assignment: {
    teamId: number;
    teamName: string | null;
    routeOrder: number;
    estimatedArrivalMs: number | null;
    estimatedDepartureMs: number | null;
    driveTimeSecs: number | null;
    isManual: number;
    rationale: {
      driveCostSecs: number;
      ratingBonus: number;
      teamAvgRating: number | null;
      loadPenaltySecs: number;
      floorBonus: number;
      wasLocked: boolean;
      homeReturnBonus?: number;
      summary: string;
    } | null;
  } | null;
}

// ── Team colors ───────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

// ── Date helpers (Eastern Time) ───────────────────────────────────────────────────────

const ET = "America/New_York";

// Returns YYYY-MM-DD in Eastern Time
function todayStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ET });
}

function formatDate(dateStr: string): string {
  // Parse as noon ET to avoid any DST edge cases
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ET });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: ET });
}

function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  // ms is a Unix timestamp — convert to Eastern Time for display
  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDrive(secs: number | null | undefined): string {
  if (!secs) return "";
  if (secs < 60) return `${secs}s drive`;
  return `${Math.round(secs / 60)}m drive`;
}

// ── Team Form ─────────────────────────────────────────────────────────────────

function TeamForm({ team, onClose }: { team?: Team; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(team?.name ?? "");
  const [homeAddress, setHomeAddress] = useState(team?.homeAddress ?? "");
  const [maxHours, setMaxHours] = useState(String(team?.maxHoursPerDay ?? 8));
  const [color, setColor] = useState(team?.color ?? PRESET_COLORS[0]);

  const upsert = trpc.scheduling.upsertTeam.useMutation({
    onSuccess: () => {
      utils.scheduling.getTeams.invalidate();
      toast.success(team ? "Team updated" : "Team added");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Team Name</Label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Team Solange" className="mt-1" />
      </div>
      <div>
        <Label>Home Base Address</Label>
        <Input value={homeAddress} onChange={e => setHomeAddress(e.target.value)} placeholder="123 Main St, Washington DC" className="mt-1" />
        <p className="text-xs text-gray-400 mt-1">Used as the starting point for route optimization</p>
      </div>
      <div>
        <Label>Max Hours / Day</Label>
        <Input type="number" value={maxHours} onChange={e => setMaxHours(e.target.value)} min={1} max={16} className="mt-1 w-24" />
      </div>
      <div>
        <Label>Color</Label>
        <div className="flex gap-2 mt-1 flex-wrap">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? "border-gray-900 scale-110" : "border-transparent"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => upsert.mutate({ id: team?.id, name, homeAddress, maxHoursPerDay: parseFloat(maxHours) || 8, color })}
          disabled={!name || upsert.isPending}
          className="flex-1"
        >
          {upsert.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {team ? "Save Changes" : "Add Team"}
        </Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Job Card ──────────────────────────────────────────────────────────────────

function JobCard({
  job, teams, date, isSelected, onSelect, isLocked, onLockToggle, homeDriveTimeSecs,
  onReassignStart, onReassignDone, onUnassignStart, onUnassignDone, onIssueClick, hasConflict, isLastJob,
}: {
  job: Job;
  teams: Team[];
  date: string;
  isSelected: boolean;
  onSelect: () => void;
  isLocked?: boolean;
  onLockToggle?: (locked: boolean, position?: number) => void;
  homeDriveTimeSecs?: number | null;
  onReassignStart?: (destTeamId: number, srcTeamId: number | null) => void;
  onReassignDone?: (destTeamId: number, srcTeamId: number | null) => void;
  onUnassignStart?: (srcTeamId: number | null) => void;
  onUnassignDone?: (srcTeamId: number | null) => void;
  onIssueClick?: () => void;
  hasConflict?: boolean;
  isLastJob?: boolean;
}) {
  // Open reassign dialog on card click (in addition to map selection)
  const utils = trpc.useUtils();
  const [showReassign, setShowReassign] = useState(false);
  const unassignJob = trpc.scheduling.unassignJob.useMutation({
    onSuccess: () => {
      utils.scheduling.getSchedule.invalidate({ date });
      onUnassignDone?.(job.assignment?.teamId ?? null);
      toast.success("Job unassigned");
    },
    onError: (e) => {
      onUnassignDone?.(job.assignment?.teamId ?? null);
      toast.error(e.message);
    },
  });
  const lockJobMutation = trpc.scheduling.lockJob.useMutation({
    onSuccess: () => utils.scheduling.getJobLocks.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });
  const manualAssign = trpc.scheduling.manualAssign.useMutation({
    onSuccess: (_data, variables) => {
      utils.scheduling.getSchedule.invalidate({ date });
      onReassignDone?.(variables.teamId, variables.sourceTeamId ?? null);
      // Auto-lock the job to the newly assigned team so it survives the next optimize
      lockJobMutation.mutate({
        jobId: job.id,
        date,
        cleanerId: variables.teamId,
        lockedPosition: job.assignment?.routeOrder ?? 0,
      });
      setShowReassign(false);
      toast.success("Job reassigned & locked");
    },
    onError: (_e, variables) => {
      onReassignDone?.(variables.teamId, variables.sourceTeamId ?? null);
      toast.error(_e.message);
    },
  });

  const a = job.assignment;
  // Show the actual booked time from Launch27 (serviceDateTime), not the optimizer's estimated arrival
  const bookedTimeStr = job.serviceDateTime ? formatTime(new Date(job.serviceDateTime).getTime()) : "—";
  // For the first job in a team, show drive time from home; for subsequent jobs, show job-to-job drive time
  const rawDriveSecs = homeDriveTimeSecs != null ? homeDriveTimeSecs : (a?.driveTimeSecs ?? null);
  const driveStr = formatDrive(rawDriveSecs);
  // Home return time for last job — use homeReturnBonus from rationale (it's the actual home-return drive time in secs)
  const homeReturnSecs = isLastJob && a?.rationale?.homeReturnBonus && a.rationale.homeReturnBonus > 0
    ? a.rationale.homeReturnBonus
    : null;
  const [showRationale, setShowRationale] = useState(false);

  return (
    <>
      <div
        onClick={() => { onSelect(); setShowReassign(true); }}
        className={`group relative bg-white rounded-xl border transition-all cursor-pointer hover:shadow-md ${
          hasConflict ? "border-red-400 bg-red-50/40 ring-1 ring-red-200" : isSelected ? "border-indigo-400 shadow-md ring-1 ring-indigo-200" : isLocked ? "border-amber-200 bg-amber-50/30" : !job.assignment ? "border-amber-300 bg-amber-50/40 hover:border-amber-400" : "border-gray-100 hover:border-gray-200"
        }`}
      >
        <div className="p-3">
          <div className="flex items-start gap-2">
            <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <span className="font-medium text-sm text-gray-900 truncate">{job.customerName ?? "Unknown"}</span>
                {a?.isManual === 1 && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-amber-300 text-amber-600">Manual</Badge>
                )}
                {job.isNewClient && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-emerald-400 text-emerald-600 bg-emerald-50">New</Badge>
                )}
                {job.isRecurring && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-blue-300 text-blue-600 bg-blue-50">Recurring</Badge>
                )}
                {job.isMoveInOut && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-purple-300 text-purple-600 bg-purple-50">Move In/Out</Badge>
                )}
              </div>
              <div className="flex items-start gap-1 text-xs text-gray-400">
                <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                <span className="break-words min-w-0 flex-1">{job.jobAddress ?? "No address"}</span>
              </div>
              {(job.serviceType || job.frequency) && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  {job.serviceType && (
                    <span className="text-xs text-gray-400 truncate">{job.serviceType}</span>
                  )}
                  {job.frequency && (
                    <>
                      {job.serviceType && <span className="text-gray-300 text-xs">·</span>}
                      <span className="text-xs text-indigo-400 font-medium truncate">{job.frequency.replace(/\s*\(.*?\)/g, "").trim()}</span>
                    </>
                  )}
                </div>
              )}
              {!job.assignment && (
                <div className="flex items-center gap-1 mt-1 text-xs font-medium text-amber-600">
                  <span>Tap to assign</span>
                </div>
              )}
              {hasConflict && (
                <div className="flex items-center gap-1 mt-1 text-xs font-medium text-red-600">
                  <AlertCircle className="w-3 h-3 shrink-0" />
                  <span>Time conflict — ask client to adjust</span>
                </div>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                {bookedTimeStr !== "—" && (
                  <div className="flex items-center gap-1 text-xs text-indigo-600 font-medium">
                    <Clock className="w-3 h-3" />
                    {bookedTimeStr}
                  </div>
                )}
                {driveStr && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-400">
                      {homeDriveTimeSecs != null
                        ? `🏠 ${driveStr.replace(" drive", "")} from home`
                        : `🚗 ${driveStr.replace(" drive", "")} drive to get here`}
                    </span>
                    {homeReturnSecs && (
                      <span className="text-xs text-gray-400">
                        · 🏠 {Math.round(homeReturnSecs / 60)}m home
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              {/* Lock toggle */}
              <button
                onClick={e => { e.stopPropagation(); onLockToggle?.(!!isLocked); }}
                className={`p-1 rounded transition-all ${isLocked ? "text-amber-500 opacity-100" : "opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-500"} hover:bg-amber-50`}
                title={isLocked ? "Unlock position" : "Lock position"}
              >
                {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
              {/* Rationale info button — always visible when rationale is available */}
              {a?.rationale && (
                <button
                  onClick={e => { e.stopPropagation(); setShowRationale(true); }}
                  className="p-1 rounded hover:bg-blue-50 transition-all"
                  title="Why this assignment?"
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                </button>
              )}
              {/* Reassign button */}
              <button
                onClick={e => { e.stopPropagation(); setShowReassign(true); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 transition-all"
                title="Reassign team"
              >
                <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {/* Issue / Call button */}
              <button
                onClick={e => { e.stopPropagation(); onIssueClick?.(); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-orange-50 transition-all"
                title="Raise issue & fire AI call"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-gray-400 hover:text-orange-500" />
              </button>
              {/* Unassign button — only shown for assigned jobs */}
              {job.assignment && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    const srcId = job.assignment?.teamId ?? null;
                    onUnassignStart?.(srcId);
                    unassignJob.mutate({ date, cleanerJobId: job.id });
                  }}
                  disabled={unassignJob.isPending}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all"
                  title="Unassign job"
                >
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rationale popup */}
      {a?.rationale && createPortal(
        <div
          className={`fixed inset-0 z-[9999] flex items-end sm:items-center justify-center transition-all ${showRationale ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          onClick={() => setShowRationale(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 mb-4 sm:mb-0 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">AI Assignment</span>
              <button onClick={() => setShowRationale(false)} className="p-1 rounded-full hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            {/* Recommended team */}
            <div className="mx-4 mb-3 p-3 rounded-xl border border-gray-100 flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-gray-900">{a.teamName}</p>
                <p className="text-xs text-gray-400">Recommended team</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
            {/* Why this works */}
            <div className="mx-4 mb-3 p-3 rounded-xl border border-blue-100 bg-blue-50/40">
              <div className="flex items-center gap-1.5 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-xs font-semibold text-blue-700">Why this works</span>
              </div>
              <p className="text-sm text-gray-700 leading-snug">
                {(!a.rationale.wasLocked && a.rationale.summary?.toLowerCase().includes('existing launch27'))
                  ? `Best route fit — assigned by optimizer`
                  : a.rationale.summary}
              </p>
            </div>
            {/* Factors weighed */}
            <div className="px-4 pb-1">
              <span className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">Factors Weighed</span>
            </div>
            <div className="mx-4 mb-4 space-y-1">
              <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-800">Distance / route fit</p>
                  <p className="text-xs text-gray-400">{Math.round(a.rationale.driveCostSecs / 60)} min insertion cost</p>
                </div>
              </div>
              {a.rationale.teamAvgRating != null && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                  <span className="text-base shrink-0">⭐</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Team quality score</p>
                    <p className="text-xs text-gray-400">{a.rationale.teamAvgRating.toFixed(1)} avg rating · {a.rationale.ratingBonus > 0 ? `+${a.rationale.ratingBonus}s bonus` : a.rationale.ratingBonus < 0 ? `${a.rationale.ratingBonus}s penalty` : "neutral"}</p>
                  </div>
                </div>
              )}
              {a.rationale.loadPenaltySecs > 0 && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                  <Users className="w-4 h-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Load balancing</p>
                    <p className="text-xs text-gray-400">+{Math.round(a.rationale.loadPenaltySecs / 60)} min penalty for overloaded team</p>
                  </div>
                </div>
              )}
              {a.rationale.floorBonus > 0 && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                  <ArrowDown className="w-4 h-4 text-green-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Min jobs floor</p>
                    <p className="text-xs text-gray-400">Team preferred — below minimum job target</p>
                  </div>
                </div>
              )}
              {a.rationale.wasLocked && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                  <Lock className="w-4 h-4 text-gray-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Existing assignment</p>
                    <p className="text-xs text-gray-400">Preserved from Launch27</p>
                  </div>
                </div>
              )}
              {(a.rationale.homeReturnBonus != null && a.rationale.homeReturnBonus > 0) && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                  <Home className="w-4 h-4 text-indigo-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">On the way home</p>
                    <p className="text-xs text-gray-400">Reduces end-of-day commute · saves ~{Math.round(a.rationale.homeReturnBonus / 60)} min equivalent</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <Dialog open={showReassign} onOpenChange={setShowReassign}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{job.assignment ? "Reassign Job" : "Assign Job"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">{job.customerName} — {job.jobAddress}</p>
          <div className="space-y-2 mt-2">
            {teams.filter(t => t.isActive).map(t => (
              <button
                key={t.id}
                onClick={() => {
                  const srcId = job.assignment?.teamId ?? null;
                  onReassignStart?.(t.id, srcId);
                  manualAssign.mutate({ date, cleanerJobId: job.id, teamId: t.id, sourceTeamId: srcId ?? undefined });
                }}
                disabled={manualAssign.isPending}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-all text-left"
              >
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color ?? "#6366f1" }} />
                <span className="text-sm font-medium">{t.name}</span>
                {a?.teamId === t.id && <Badge variant="outline" className="ml-auto text-xs">Current</Badge>}
              </button>
            ))}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {job.assignment && (
              <Button
                variant="outline"
                className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                onClick={() => {
                  const srcId = job.assignment?.teamId ?? null;
                  onUnassignStart?.(srcId);
                  unassignJob.mutate({ date, cleanerJobId: job.id });
                  setShowReassign(false);
                }}
                disabled={unassignJob.isPending}
              >
                Unassign
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowReassign(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Team Day Config Button ─────────────────────────────────────────────────────
const TIME_PRESETS = [
  { label: "8:30 AM", value: "08:30" },
  { label: "9:00 AM", value: "09:00" },
  { label: "10:00 AM", value: "10:00" },
  { label: "12:00 PM", value: "12:00" },
];


// ─── TeamHeaderRow ───────────────────────────────────────────────────────────
// Clean team header: name + status badges always visible.
// All controls (rating, limits, power, lock, config) live in a popup.
function TeamHeaderRow({
  team, isUnavailable, isTeamLocked, teamConflictCount, teamCheckin,
  driveLabel, recalculating, date,
  onMarkUnavailable, onMarkAvailable, onLockTeam, onUnlockTeam, onSaveLimits, onSaveTag,
}: {
  team: { id: number; name: string; color?: string | null; avgRating?: number | null; ratingCount?: number;
    minJobs?: number | null; maxJobs?: number | null; earliestStartTime?: string | null; tag?: string | null; regionTags?: string | null };
  isUnavailable: boolean;
  isTeamLocked: boolean;
  teamConflictCount: number;
  teamCheckin: { isAvailable: boolean; maxJobs?: number | null; note?: string | null } | null;
  driveLabel: string | null;
  recalculating: boolean;
  date: string;
  onMarkUnavailable: () => void;
  onMarkAvailable: () => void;
  onLockTeam: () => void;
  onUnlockTeam: () => void;
  onSaveLimits: (minJobs: number | null, maxJobs: number | null, earliestStartTime: string | null) => void;
  onSaveTag: (tag: string | null) => void;
  onSaveRegionTags: (regionTags: string | null) => void;
}) {
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [popStyle, setPopStyle] = React.useState<React.CSSProperties>({});
  // Track whether the nested config popover is open so we don't close the outer popup
  const configOpenRef = React.useRef(false);
  // Tag editing state
  const [tagInput, setTagInput] = React.useState(team.tag ?? '');
  React.useEffect(() => { setTagInput(team.tag ?? ''); }, [team.tag]);

  const openPopup = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const w = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= 320 ? rect.bottom + 4 : rect.top - 320 - 4;
    let left = rect.right - w;
    if (left < 8) left = 8;
    setPopStyle({ position: 'fixed', top, left, width: w, zIndex: 9999 });
    setOpen(true);
  };

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      // Don't close if the config sub-popover is open
      if (configOpenRef.current) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const fmtTime = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  const hasLimits = team.minJobs != null || team.maxJobs != null || team.earliestStartTime != null;

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${isUnavailable ? 'bg-red-50 border-red-100' : 'border-gray-50'}`}>
      {/* Color dot */}
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: isUnavailable ? '#ef4444' : (team.color ?? '#6366f1') }} />

      {/* Name — clickable to open popup */}
      <button
        ref={btnRef}
        onClick={openPopup}
        className={`font-semibold text-sm truncate max-w-[120px] text-left hover:underline ${
          isUnavailable ? 'text-red-500 line-through' : 'text-gray-900'
        }`}
        title="Click for team controls"
      >
        {team.name}
      </button>

      {/* Always-visible status badges */}
      {isUnavailable && <span className="text-[10px] font-medium text-red-400 bg-red-100 px-1.5 py-0.5 rounded shrink-0">OFF</span>}
      {teamCheckin && (
        <span
          title={teamCheckin.isAvailable
            ? `✅ Confirmed — up to ${teamCheckin.maxJobs != null && teamCheckin.maxJobs >= 10 ? '4+' : teamCheckin.maxJobs ?? '?'} jobs${teamCheckin.note ? ` · ${teamCheckin.note}` : ''}`
            : `❌ Not available${teamCheckin.note ? ` · ${teamCheckin.note}` : ''}`
          }
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
            teamCheckin.isAvailable ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'
          }`}
        >
          {teamCheckin.isAvailable ? '✅' : '❌'}
          {teamCheckin.isAvailable && teamCheckin.maxJobs != null && (
            <span className="ml-0.5">{teamCheckin.maxJobs >= 10 ? '4+' : teamCheckin.maxJobs}j</span>
          )}
        </span>
      )}
      {teamConflictCount > 0 && (
        <span title={`${teamConflictCount} conflict${teamConflictCount > 1 ? 's' : ''}`}
          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">
          ⚠ {teamConflictCount}
        </span>
      )}
      {recalculating && (
        <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
      )}

      {/* Tag pill — shown when set */}
      {team.tag && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-violet-50 text-violet-700 border-violet-200 shrink-0">{team.tag}</span>
      )}
      {/* Region tag pills */}
      {(team.regionTags ?? '').split(',').map(s => s.trim()).filter(Boolean).map(r => (
        <span key={r} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
          r === 'DC' ? 'bg-blue-50 text-blue-700 border-blue-200'
          : r === 'MD' ? 'bg-green-50 text-green-700 border-green-200'
          : 'bg-yellow-50 text-yellow-700 border-yellow-200'
        }`}>{r}</span>
      ))}

      {/* Drive label + indicator dots pushed to right */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {driveLabel && <span className="text-[11px] font-medium text-orange-400">{driveLabel}</span>}
        {/* Subtle indicator dots for active states */}
        {isTeamLocked && <span className="w-2 h-2 rounded-full bg-amber-400" title="Team locked" />}
        {hasLimits && (
          <span
            className="w-2 h-2 rounded-full bg-indigo-400 cursor-default"
            title={[
              team.minJobs != null ? `Min ${team.minJobs} jobs` : null,
              team.maxJobs != null ? `Max ${team.maxJobs} jobs` : null,
              team.earliestStartTime != null ? `Start after ${fmtTime(team.earliestStartTime)}` : null,
            ].filter(Boolean).join(' · ')}
          />
        )}
        {/* Chevron to open popup */}
        <button ref={btnRef} onClick={openPopup}
          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Team controls"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Popup */}
      {open && createPortal(
        <div ref={popRef} style={popStyle}
          className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 space-y-3"
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{team.name}</p>

          {/* Tag input */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 w-20 shrink-0">Tag</span>
            <input
              type="text"
              maxLength={20}
              placeholder="e.g. VIP, AM, Flex"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = tagInput.trim() || null;
                  onSaveTag(val);
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setTagInput(team.tag ?? '');
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                const val = tagInput.trim() || null;
                if (val !== (team.tag ?? null)) onSaveTag(val);
              }}
              className="flex-1 text-[11px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-violet-400 bg-white"
            />
          </div>

          {/* Region tags */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 w-20 shrink-0">Region</span>
            <div className="flex gap-1">
              {(['DC', 'MD', 'VA'] as const).map(r => {
                const active = (team.regionTags ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => {
                      const current = (team.regionTags ?? '').split(',').map(s => s.trim()).filter(Boolean);
                      const next = active ? current.filter(x => x !== r) : [...current, r];
                      onSaveRegionTags(next.length > 0 ? next.join(',') : null);
                    }}
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded border transition-colors ${
                      active
                        ? r === 'DC' ? 'bg-blue-100 text-blue-700 border-blue-300'
                          : r === 'MD' ? 'bg-green-100 text-green-700 border-green-300'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-300'
                        : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rating */}
          {team.avgRating != null && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-20 shrink-0">Rating</span>
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                ⭐ {team.avgRating.toFixed(1)}
              </span>
              <span className="text-[10px] text-gray-400">{team.ratingCount} job{team.ratingCount === 1 ? '' : 's'}</span>
            </div>
          )}

          {/* Job limits */}
          {hasLimits && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-gray-500 w-20 shrink-0">Limits</span>
              {team.minJobs != null && (
                <span title={`Min ${team.minJobs} jobs`} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">
                  <ArrowDown className="w-2.5 h-2.5" />{team.minJobs}
                </span>
              )}
              {team.maxJobs != null && (
                <span title={`Max ${team.maxJobs} jobs`} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                  <ArrowUp className="w-2.5 h-2.5" />{team.maxJobs}
                </span>
              )}
              {team.earliestStartTime != null && (
                <span title={`Start after ${fmtTime(team.earliestStartTime)}`} className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-purple-600 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                  <Timer className="w-2.5 h-2.5" />{fmtTime(team.earliestStartTime)}
                </span>
              )}
            </div>
          )}

          <div className="border-t border-gray-100 pt-3 space-y-2">
            {/* Mark available / unavailable */}
            <button
              onClick={() => { isUnavailable ? onMarkAvailable() : onMarkUnavailable(); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isUnavailable
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
            >
              <Power className="w-4 h-4" />
              {isUnavailable ? 'Mark available' : 'Mark unavailable today'}
            </button>

            {/* Lock / Unlock */}
            <button
              onClick={() => { isTeamLocked ? onUnlockTeam() : onLockTeam(); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isTeamLocked
                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {isTeamLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              {isTeamLocked ? 'Unlock team' : 'Lock team'}
            </button>

            {/* Edit limits — no wrapper onClick; config popover manages its own open state */}
            <TeamDayConfigButton
              teamId={team.id}
              date={date}
              config={{ minJobs: team.minJobs ?? null, maxJobs: team.maxJobs ?? null, earliestStartTime: team.earliestStartTime ?? null }}
              onSave={(minJobs, maxJobs, earliestStartTime) => {
                // Save limits but keep the outer popup open so user can see updated values
                onSaveLimits(minJobs, maxJobs, earliestStartTime);
              }}
              onCopyToTomorrow={undefined}
              onOpenChange={(isOpen) => { configOpenRef.current = isOpen; }}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


function TeamDayConfigButton({
  teamId, date, config, onSave, onCopyToTomorrow, onOpenChange,
}: {
  teamId: number;
  date: string;
  config: { minJobs: number | null; maxJobs: number | null; earliestStartTime: string | null } | null;
  onSave: (minJobs: number | null, maxJobs: number | null, earliestStartTime: string | null) => void;
  onCopyToTomorrow?: ((minJobs: number | null, maxJobs: number | null, earliestStartTime: string | null) => void) | undefined;
  onOpenChange?: (isOpen: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const setOpenWithCallback = React.useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setOpen(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);
  const [minJobs, setMinJobs] = React.useState<string>(config?.minJobs != null ? String(config.minJobs) : "");
  const [maxJobs, setMaxJobs] = React.useState<string>(config?.maxJobs != null ? String(config.maxJobs) : "");
  const [startTime, setStartTime] = React.useState<string>(config?.earliestStartTime ?? "");
  const [copied, setCopied] = React.useState(false);

  // Sync state when config changes (e.g. after save)
  React.useEffect(() => {
    setMinJobs(config?.minJobs != null ? String(config.minJobs) : "");
    setMaxJobs(config?.maxJobs != null ? String(config.maxJobs) : "");
    setStartTime(config?.earliestStartTime ?? "");
  }, [config?.minJobs, config?.maxJobs, config?.earliestStartTime]);

  const hasConfig = config?.minJobs != null || config?.maxJobs != null || config?.earliestStartTime != null;

  function handleSave() {
    const mn = minJobs.trim() === "" ? null : parseInt(minJobs.trim(), 10);
    const mj = maxJobs.trim() === "" ? null : parseInt(maxJobs.trim(), 10);
    const st = startTime.trim() === "" ? null : startTime.trim();
    onSave(
      isNaN(mn as number) ? null : mn,
      isNaN(mj as number) ? null : mj,
      st,
    );
    setOpenWithCallback(false);
  }

  function handleClear() {
    onSave(null, null, null);
    setMinJobs("");
    setMaxJobs("");
    setStartTime("");
    setOpenWithCallback(false);
  }

  function handleCopyToTomorrow() {
    onCopyToTomorrow?.(config?.minJobs ?? null, config?.maxJobs ?? null, config?.earliestStartTime ?? null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Format HH:MM to 12-hour display
  function formatTimeDisplay(hhmm: string) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }

  const btnRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties>({});

  React.useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popoverWidth = 256;
    const popoverHeight = 320; // estimated height
    let left = rect.right - popoverWidth;
    if (left < 8) left = 8;
    // Flip above the button if there isn't enough space below
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= popoverHeight + 8
      ? rect.bottom + 4
      : Math.max(8, rect.top - popoverHeight - 4);
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width: popoverWidth,
      zIndex: 9999,
    });
  }, [open]);

  // Close only when clicking outside BOTH the button AND the popover panel
  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (btnRef.current && btnRef.current.contains(e.target as Node)) return;
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return;
      setOpenWithCallback(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        title="Set daily limits for this team"
        onClick={() => setOpenWithCallback(v => !v)}
        className={`w-7 h-7 flex items-center justify-center rounded-full border transition-colors ${
          hasConfig
            ? "bg-blue-100 text-blue-600 border-blue-300 hover:bg-blue-200"
            : "bg-gray-50 text-gray-400 border-gray-200 hover:bg-blue-50 hover:text-blue-500 hover:border-blue-200"
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && createPortal(
        <div ref={popoverRef} style={popoverStyle} className="bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-64 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-700">Team Limits</span>
            <button onClick={() => setOpenWithCallback(false)} className="text-gray-400 hover:text-gray-600 text-sm leading-none">✕</button>
          </div>

          {/* Job count row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Min jobs</label>
              <input
                type="number"
                min={0}
                max={20}
                placeholder="None"
                value={minJobs}
                onChange={e => setMinJobs(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">Max jobs</label>
              <input
                type="number"
                min={1}
                max={20}
                placeholder="None"
                value={maxJobs}
                onChange={e => setMaxJobs(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Earliest start */}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1.5">Earliest start time</label>
            {/* Preset chips */}
            <div className="flex flex-wrap gap-1 mb-2">
              {TIME_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setStartTime(p.value)}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                    startTime === p.value
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-purple-50 hover:text-purple-600 hover:border-purple-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* Time input */}
            <div className="relative">
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-100"
              />
              {startTime && (
                <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[11px] text-purple-500 font-medium pointer-events-none">
                  {formatTimeDisplay(startTime)}
                </span>
              )}
              {startTime && (
                <button
                  onClick={() => setStartTime("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-xs"
                  title="Clear time"
                >✕</button>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 text-[11px] font-semibold bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
            {hasConfig && (
              <button
                onClick={handleClear}
                className="text-[11px] font-medium text-gray-400 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {hasConfig && onCopyToTomorrow && (
            <button
              onClick={handleCopyToTomorrow}
              className={`w-full text-[11px] font-medium border rounded-lg px-2 py-1.5 transition-colors ${
                copied
                  ? "bg-green-50 text-green-600 border-green-200"
                  : "text-gray-500 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {copied ? "✓ Copied to tomorrow" : "Copy to tomorrow →"}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Map renderer ──────────────────────────────────────────────────────────────

function ScheduleMap({
  jobs, teams, selectedJobId, onJobSelect,
}: {
  jobs: Job[];
  teams: Team[];
  selectedJobId: number | null;
  onJobSelect: (id: number) => void;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const teamColorMap = new Map(teams.map(t => [t.id, t.color ?? "#6366f1"]));

  const renderMap = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();

    // Clear old markers/polylines
    markersRef.current.forEach(m => m.setMap(null));
    polylinesRef.current.forEach(p => p.setMap(null));
    markersRef.current = [];
    polylinesRef.current = [];

    // Group jobs by team
    const byTeam = new Map<number, Job[]>();
    for (const job of jobs) {
      if (!job.assignment) continue;
      const tid = job.assignment.teamId;
      if (!byTeam.has(tid)) byTeam.set(tid, []);
      byTeam.get(tid)!.push(job);
    }

    // Sort each team's jobs by routeOrder
    for (const [, teamJobs] of Array.from(byTeam.entries())) {
      teamJobs.sort((a, b) => (a.assignment?.routeOrder ?? 0) - (b.assignment?.routeOrder ?? 0));
    }

    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    // Draw team home markers
    for (const team of teams) {
      if (!team.homeLat || !team.homeLng || !team.isActive) continue;
      const pos = { lat: team.homeLat, lng: team.homeLng };
      bounds.extend(pos);
      hasPoints = true;
      const homeMarker = new google.maps.Marker({
        position: pos,
        map,
        title: `${team.name} (Home)`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: team.color ?? "#6366f1",
          fillOpacity: 0.3,
          strokeColor: team.color ?? "#6366f1",
          strokeWeight: 2,
        },
        zIndex: 1,
      });
      markersRef.current.push(homeMarker);
    }

    // Count total geocode requests so we can fitBounds exactly once after all complete
    const assignedJobs = Array.from(byTeam.values()).flat().filter(j => !!j.jobAddress);
    const unassignedJobs = byTeam.size === 0 ? jobs.slice(0, 20).filter(j => !!j.jobAddress) : [];
    const totalGeocodes = assignedJobs.length + unassignedJobs.length;
    let completedGeocodes = 0;
    const maybeFitBounds = () => {
      completedGeocodes++;
      if (completedGeocodes === totalGeocodes && hasPoints && mapRef.current) {
        // Extra bottom padding shifts the cluster toward the top of the panel
        mapRef.current.fitBounds(bounds, { top: 40, right: 60, bottom: 160, left: 60 });
      }
    };

    // Draw routes + job markers
    for (const [teamId, teamJobs] of Array.from(byTeam.entries())) {
      const color = teamColorMap.get(teamId) ?? "#6366f1";
      const team = teams.find(t => t.id === teamId);
      const routePoints: google.maps.LatLng[] = [];

      // Start from home if available
      if (team?.homeLat && team?.homeLng) {
        routePoints.push(new google.maps.LatLng(team.homeLat, team.homeLng));
      }

      for (let i = 0; i < teamJobs.length; i++) {
        const job = teamJobs[i];
        if (!job.jobAddress) continue;

        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: job.jobAddress }, (results, status) => {
          if (status !== "OK" || !results?.[0]) { maybeFitBounds(); return; }
          const pos = results[0].geometry.location;
          bounds.extend(pos);
          hasPoints = true;
          routePoints.push(pos);

          // Draw marker
          const isSelected = job.id === selectedJobId;
          const marker = new google.maps.Marker({
            position: pos,
            map,
            title: job.customerName ?? "Job",
            label: {
              text: String(i + 1),
              color: "white",
              fontSize: "11px",
              fontWeight: "bold",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: isSelected ? 18 : 14,
              fillColor: color,
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            },
            zIndex: isSelected ? 10 : 5,
          });

          marker.addListener("click", () => {
            onJobSelect(job.id);
            infoWindowRef.current?.setContent(`
              <div style="font-family:sans-serif;padding:4px 0;max-width:200px">
                <div style="font-weight:600;font-size:13px">${job.customerName ?? "Job"}</div>
                <div style="color:#6b7280;font-size:12px;margin-top:2px">${job.jobAddress}</div>
                ${job.serviceDateTime ? `<div style="color:#6366f1;font-size:12px;margin-top:4px">${formatTime(new Date(job.serviceDateTime).getTime())}</div>` : ""}
              </div>
            `);
            infoWindowRef.current?.open(map, marker);
          });

          markersRef.current.push(marker);

          // Draw polyline segment if we have 2+ points
          if (routePoints.length >= 2) {
            const line = new google.maps.Polyline({
              path: routePoints.slice(-2),
              geodesic: true,
              strokeColor: color,
              strokeOpacity: 0.7,
              strokeWeight: 3,
              map,
            });
            polylinesRef.current.push(line);
          }

          maybeFitBounds();
        });
      }
    }

    // If no assignments yet, show all job addresses
    if (byTeam.size === 0) {
      const geocoder = new google.maps.Geocoder();
      for (const job of unassignedJobs) {
        geocoder.geocode({ address: job.jobAddress! }, (results, status) => {
          if (status !== "OK" || !results?.[0]) { maybeFitBounds(); return; }
          const pos = results[0].geometry.location;
          bounds.extend(pos);
          hasPoints = true;
          const marker = new google.maps.Marker({
            position: pos,
            map,
            title: job.customerName ?? "Job",
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#9ca3af",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            },
          });
          markersRef.current.push(marker);
          maybeFitBounds();
        });
      }
    }

    // If there are no geocodable jobs at all, fit to team homes
    if (totalGeocodes === 0 && hasPoints && mapRef.current) {
      mapRef.current.fitBounds(bounds, { top: 40, right: 60, bottom: 160, left: 60 });
    }
  }, [jobs, teams, selectedJobId, onJobSelect]);

  return (
      <MapView
      onMapReady={renderMap}
      className="w-full h-full rounded-xl overflow-hidden"
      initialCenter={{ lat: 38.9, lng: -77.03 }}
      initialZoom={11}
    />
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SchedulingTab() {
  const utils = trpc.useUtils();
  const [date, setDate] = useState(todayStr);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [editingTeam, setEditingTeam] = useState<Team | undefined>(undefined);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamSheetOpen, setTeamSheetOpen] = useState(false);
  // Call Command Center state
  const [issueDialogJob, setIssueDialogJob] = useState<{ id: number; date: string } | null>(null);
  const [callLogOpen, setCallLogOpen] = useState(false);
  const { data: dayIssues = [] } = trpc.calls.getDayIssues.useQuery({ jobDate: date }, { refetchInterval: 30_000 });

  // Check-ins for the selected date — cleaners submitted these the day before
  const tomorrowDate = addDays(date, 1);
  const { data: checkins = [] } = trpc.cleaner.getCheckinsForDate.useQuery(
    { date: date },
    { refetchInterval: 60_000 }
  );

  // Set of teamIds currently being recalculated (show spinner on their headers)
  const [recalculatingTeams, setRecalculatingTeams] = useState<Set<number>>(new Set());
  const markRecalculating = (ids: number[]) =>
    setRecalculatingTeams(prev => new Set([...Array.from(prev), ...ids]));
  const clearRecalculating = (ids: number[]) =>
    setRecalculatingTeams(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s; });

  // Post-optimize summary banner
  const prevDriveMinsRef = useRef<number | null>(null);
  const [optimizeSummary, setOptimizeSummary] = useState<{
    assigned: number;
    totalDriveMins: number;
    driveDeltaMins: number | null; // positive = more drive, negative = less drive
    conflictCount: number;
    teamsUnderFloor: string[];
  } | null>(null);

  // Suggest Slot panel
  const [suggestInput, setSuggestInput] = useState("");
  const [suggestAddress, setSuggestAddress] = useState("");
  const suggestRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [googleMapsReady, setGoogleMapsReady] = useState(false);

  const { data: suggestData, isFetching: suggestFetching } = trpc.scheduling.suggestSlots.useQuery(
    { address: suggestAddress, date },
    { enabled: suggestAddress.length > 5, staleTime: 60_000 }
  );

  const { data, isLoading, refetch } = trpc.scheduling.getSchedule.useQuery(
    { date },
    { staleTime: 30_000, refetchOnWindowFocus: false }
  );

  const optimize = trpc.scheduling.optimizeDay.useMutation({
    onMutate: () => {
      // Snapshot current total drive time before optimize runs
      const currentDriveMins = Math.round(
        (data?.jobs ?? []).reduce((s: number, j: Job) => s + (j.assignment?.driveTimeSecs ?? 0), 0) / 60
      );
      prevDriveMinsRef.current = currentDriveMins > 0 ? currentDriveMins : null;
    },
    onSuccess: (result) => {
      utils.scheduling.getSchedule.invalidate({ date });
      utils.scheduling.getJobLocks.invalidate({ date });
      // Banner will be populated after schedule data refreshes via useEffect below
      setOptimizeSummary({ assigned: result.assigned, totalDriveMins: 0, driveDeltaMins: null, conflictCount: 0, teamsUnderFloor: [] });
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: jobLocks = [] } = trpc.scheduling.getJobLocks.useQuery({ date });
  const lockedJobIds = new Set(jobLocks.map(l => l.jobId));
  const lockJob = trpc.scheduling.lockJob.useMutation({
    onSuccess: () => utils.scheduling.getJobLocks.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });
  const unlockJob = trpc.scheduling.unlockJob.useMutation({
    onSuccess: () => utils.scheduling.getJobLocks.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });
  const resetOptimization = trpc.scheduling.resetOptimization.useMutation({
    onSuccess: () => {
      utils.scheduling.getSchedule.invalidate({ date });
      utils.scheduling.getJobLocks.invalidate({ date });
      utils.scheduling.getTeamLocks.invalidate({ date });
      toast.success("Schedule reset — all assignments and locks cleared");
    },
    onError: (e) => toast.error(e.message),
  });

  // Team unavailability for the selected date
  const { data: unavailableTeamIds = [] } = trpc.scheduling.getTeamUnavailability.useQuery({ date });
  const unavailableSet = new Set(unavailableTeamIds);
  const setUnavailable = trpc.scheduling.setTeamUnavailable.useMutation({
    onSuccess: () => utils.scheduling.getTeamUnavailability.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });
  const setAvailable = trpc.scheduling.setTeamAvailable.useMutation({
    onSuccess: () => utils.scheduling.getTeamUnavailability.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });

  // Team-level locks for the selected date
  const { data: lockedTeamIds = [] } = trpc.scheduling.getTeamLocks.useQuery({ date });
  const lockedTeamSet = new Set(lockedTeamIds);
  const lockTeam = trpc.scheduling.lockTeam.useMutation({
    onSuccess: () => utils.scheduling.getTeamLocks.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });
  const unlockTeam = trpc.scheduling.unlockTeam.useMutation({
    onSuccess: () => utils.scheduling.getTeamLocks.invalidate({ date }),
    onError: (e) => toast.error(e.message),
  });
  // Per-team limits (max jobs + earliest start time) — stored on the team row, persist until cleared
  const setTeamLimits = trpc.scheduling.setTeamLimits.useMutation({
    onSuccess: () => {
      utils.scheduling.getTeams.invalidate();
      utils.scheduling.getSchedule.invalidate({ date });
    },
    onError: (e) => toast.error(e.message),
  });
  // Per-team tag — short label shown in header (e.g. "VIP", "AM")
  const setTeamTag = trpc.scheduling.setTeamTag.useMutation({
    onSuccess: () => utils.scheduling.getTeams.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  // Per-team region tags — DC/MD/VA for first-job preference
  const setTeamRegionTags = trpc.scheduling.setTeamRegionTags.useMutation({
    onSuccess: () => utils.scheduling.getTeams.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const jobs: Job[] = (data?.jobs ?? []) as Job[];
  const teams: Team[] = (data?.teams ?? []) as Team[];
  const hasAssignments = data?.hasAssignments ?? false;

  // Badge filter state
  const [badgeFilter, setBadgeFilter] = useState<"new" | "recurring" | "moveinout" | null>(null);

  // Filter jobs by active badge filter
  const filteredJobs = badgeFilter === "new" ? jobs.filter(j => j.isNewClient)
    : badgeFilter === "recurring" ? jobs.filter(j => j.isRecurring)
    : badgeFilter === "moveinout" ? jobs.filter(j => j.isMoveInOut)
    : jobs;

  // Counts for badge filter pills
  const newCount = jobs.filter(j => j.isNewClient).length;
  const recurringCount = jobs.filter(j => j.isRecurring).length;
  const moveInOutCount = jobs.filter(j => j.isMoveInOut).length;

  // Group jobs by assigned team (use filteredJobs so badge filter applies)
  const teamGroups = new Map<number | null, Job[]>();
  teamGroups.set(null, []);
  for (const t of teams) teamGroups.set(t.id, []);
  for (const job of filteredJobs) {
    const tid = job.assignment?.teamId ?? null;
    if (!teamGroups.has(tid)) teamGroups.set(tid, []);
    teamGroups.get(tid)!.push(job);
  }
  // Sort each group by serviceDateTime first (source of truth), then routeOrder as tiebreaker.
  // routeOrder is set by the optimizer to reflect the geographically correct order for same-time jobs.
  for (const [, group] of Array.from(teamGroups.entries())) {
    group.sort((a, b) => {
      const aTime = a.serviceDateTime ? new Date(a.serviceDateTime).getTime() : Infinity;
      const bTime = b.serviceDateTime ? new Date(b.serviceDateTime).getTime() : Infinity;
      if (aTime !== bTime) return aTime - bTime;
      return (a.assignment?.routeOrder ?? 999) - (b.assignment?.routeOrder ?? 999);
    });
  }

  const unassigned = teamGroups.get(null) ?? [];
  const activeJobs = jobs.filter(j => j.bookingStatus !== "cancelled");

  // Detect time conflicts: jobs on the same team whose booked times overlap
  const conflictJobIds = new Set<number>();
  for (const [, group] of Array.from(teamGroups.entries())) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a.serviceDateTime || !b.serviceDateTime) continue;
        const aStart = new Date(a.serviceDateTime).getTime();
        const bStart = new Date(b.serviceDateTime).getTime();
        // Estimate duration from serviceType string (e.g. "3 bedroom" → 3h), default 2h
        const parseBeds = (st: string | null) => { const m = st?.match(/(\d+)\s*bed/i); return m ? parseInt(m[1]) : 0; };
        const aDurMs = Math.max(2, parseBeds(a.serviceType)) * 3600000;
        const bDurMs = Math.max(2, parseBeds(b.serviceType)) * 3600000;
        const aEnd = aStart + aDurMs;
        const bEnd = bStart + bDurMs;
        // Overlap if one starts before the other ends
        if (aStart < bEnd && bStart < aEnd) {
          conflictJobIds.add(a.id);
          conflictJobIds.add(b.id);
        }
      }
    }
  }

  // After optimize, once schedule data has refreshed, fill in real drive/conflict/floor numbers
  useEffect(() => {
    if (!optimizeSummary) return;
    const totalDriveMins = Math.round(
      jobs.reduce((s, j) => s + (j.assignment?.driveTimeSecs ?? 0), 0) / 60
    );
    const driveDeltaMins = prevDriveMinsRef.current != null && totalDriveMins > 0
      ? totalDriveMins - prevDriveMinsRef.current
      : null;
    const teamsUnderFloor = teams
      .filter(t => t.isActive && t.minJobs != null && (teamGroups.get(t.id)?.length ?? 0) < t.minJobs)
      .map(t => t.name);
    setOptimizeSummary(prev => prev ? { ...prev, totalDriveMins, driveDeltaMins, conflictCount: conflictJobIds.size, teamsUnderFloor } : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="flex flex-col gap-4">
      {/* Badge filter bar */}
      {(newCount > 0 || recurringCount > 0 || moveInOutCount > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">Filter:</span>
          <button
            onClick={() => setBadgeFilter(badgeFilter === "new" ? null : "new")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              badgeFilter === "new"
                ? "bg-emerald-500 text-white border-emerald-500"
                : "bg-emerald-50 text-emerald-600 border-emerald-200 hover:border-emerald-400"
            }`}
          >
            New <span className="opacity-70">{newCount}</span>
          </button>
          <button
            onClick={() => setBadgeFilter(badgeFilter === "recurring" ? null : "recurring")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              badgeFilter === "recurring"
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400"
            }`}
          >
            Recurring <span className="opacity-70">{recurringCount}</span>
          </button>
          {moveInOutCount > 0 && (
            <button
              onClick={() => setBadgeFilter(badgeFilter === "moveinout" ? null : "moveinout")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                badgeFilter === "moveinout"
                  ? "bg-purple-500 text-white border-purple-500"
                  : "bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-400"
              }`}
            >
              Move In/Out <span className="opacity-70">{moveInOutCount}</span>
            </button>
          )}
          {badgeFilter && (
            <button
              onClick={() => setBadgeFilter(null)}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Clear filter
            </button>
          )}
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date nav */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl px-2 py-1.5">
          <button onClick={() => setDate(d => addDays(d, -1))} className="p-1 rounded hover:bg-gray-100">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="text-sm font-medium text-gray-900 bg-transparent border-none outline-none cursor-pointer px-1"
          />
          <button onClick={() => setDate(d => addDays(d, 1))} className="p-1 rounded hover:bg-gray-100">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="text-sm text-gray-500 hidden sm:block">{formatDate(date)}</div>

        <div className="flex items-center gap-1.5 text-sm text-gray-500 bg-white border border-gray-100 rounded-xl px-3 py-1.5">
          <Users className="w-4 h-4" />
          <span>{activeJobs.length} jobs · {teams.filter(t => t.isActive).length} teams</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Team management */}
          <Sheet open={teamSheetOpen} onOpenChange={setTeamSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Settings2 className="w-4 h-4" />
                Teams
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Manage Teams</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-3">
                {showTeamForm ? (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <TeamForm
                      team={editingTeam}
                      onClose={() => { setShowTeamForm(false); setEditingTeam(undefined); }}
                    />
                  </div>
                ) : (
                  <Button
                    onClick={() => { setEditingTeam(undefined); setShowTeamForm(true); }}
                    variant="outline"
                    className="w-full gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add Team
                  </Button>
                )}
                <TeamList
                  onEdit={(t) => { setEditingTeam(t); setShowTeamForm(true); }}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* Reset button — only shown when there are assignments */}
          {hasAssignments && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("Reset schedule to original Launch27 order? All locks will be cleared.")) {
                  resetOptimization.mutate({ date });
                }
              }}
              disabled={resetOptimization.isPending || optimize.isPending}
              className="gap-1.5 text-gray-600"
              title="Reset to original Launch27 order"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
          )}
          {/* Call Log button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCallLogOpen(true)}
            className="gap-1.5 relative"
            title="View call log for this day"
          >
            <Phone className="w-4 h-4" />
            Calls
            {dayIssues.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {dayIssues.length}
              </span>
            )}
          </Button>

          {/* Lock All button */}
          {(() => {
            const assignedUnlocked = activeJobs.filter(
              j => j.assignment && j.assignment.teamId && !lockedJobIds.has(j.id)
            );
            if (assignedUnlocked.length === 0) return null;
            return (
              <Button
                variant="outline"
                onClick={async () => {
                  for (const j of assignedUnlocked) {
                    await lockJob.mutateAsync({
                      jobId: j.id,
                      date,
                      cleanerId: j.assignment!.teamId,
                      lockedPosition: j.assignment!.routeOrder ?? 0,
                    });
                  }
                  toast.success(`Locked ${assignedUnlocked.length} job${assignedUnlocked.length !== 1 ? "s" : ""}`);
                }}
                disabled={lockJob.isPending}
                className="gap-1.5"
                title="Lock all assigned jobs so they won't move when you optimize"
              >
                {lockJob.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                Lock All
              </Button>
            );
          })()}

          {/* Optimize button */}
          <Button
            onClick={() => optimize.mutate({ date })}
            disabled={optimize.isPending || activeJobs.length === 0}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {optimize.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {optimize.isPending ? "Optimizing…" : hasAssignments ? "Re-optimize" : "Optimize Routes"}
          </Button>
        </div>
      </div>

      {/* Post-optimize summary banner */}
      {optimizeSummary && (
        <div className="flex items-center gap-4 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 text-sm">
          <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
          <div className="flex items-center gap-4 flex-1 flex-wrap">
            <span className="font-medium text-indigo-700">{optimizeSummary.assigned} jobs assigned</span>
            {optimizeSummary.totalDriveMins > 0 && (
              <span className="text-indigo-600 flex items-center gap-1">
                <Timer className="w-3.5 h-3.5" />
                {optimizeSummary.totalDriveMins >= 60
                  ? `${(optimizeSummary.totalDriveMins / 60).toFixed(1)}h total drive`
                  : `${optimizeSummary.totalDriveMins}m total drive`}
              </span>
            )}
            {optimizeSummary.driveDeltaMins != null && optimizeSummary.driveDeltaMins !== 0 && (
              <span className={`flex items-center gap-0.5 font-medium text-xs px-1.5 py-0.5 rounded ${
                optimizeSummary.driveDeltaMins < 0
                  ? 'text-green-700 bg-green-100'
                  : 'text-amber-700 bg-amber-100'
              }`}>
                {optimizeSummary.driveDeltaMins < 0 ? '↓' : '↑'}
                {Math.abs(optimizeSummary.driveDeltaMins)}m vs last run
              </span>
            )}
            {optimizeSummary.conflictCount > 0 ? (
              <span className="text-red-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {optimizeSummary.conflictCount} conflict{optimizeSummary.conflictCount > 1 ? 's' : ''}
              </span>
            ) : optimizeSummary.totalDriveMins > 0 ? (
              <span className="text-green-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                No conflicts
              </span>
            ) : null}
            {optimizeSummary.teamsUnderFloor.length > 0 && (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {optimizeSummary.teamsUnderFloor.join(', ')} below minimum
              </span>
            )}
          </div>
          <button
            onClick={() => setOptimizeSummary(null)}
            className="text-indigo-400 hover:text-indigo-600 shrink-0"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tomorrow's Availability Check-ins */}
      {checkins.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Tomorrow — {formatDate(date)}
            </span>
            <div className="flex flex-wrap gap-1.5 ml-2">
              {checkins.map(c => {
                const initials = (c.cleanerName ?? 'U').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                const jobLabel = c.isAvailable
                  ? `${c.maxJobs != null && c.maxJobs >= 10 ? '4+' : c.maxJobs ?? '?'} job${c.maxJobs !== 1 ? 's' : ''}`
                  : 'Off';
                const tooltipText = c.isAvailable
                  ? `✅ ${c.cleanerName} — up to ${jobLabel}${c.note ? ` · ${c.note}` : ''}`
                  : `❌ ${c.cleanerName} — Not available${c.note ? ` · ${c.note}` : ''}`;
                return (
                  <div
                    key={c.id}
                    title={tooltipText}
                    className={`group relative flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold cursor-default select-none transition-all ${
                      c.isAvailable
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                    }`}
                  >
                    <span>{c.isAvailable ? '✅' : '❌'}</span>
                    <span>{initials}</span>
                    {c.isAvailable && (
                      <span className={`text-[10px] font-medium ${
                        c.isAvailable ? 'text-emerald-500' : 'text-red-400'
                      }`}>{jobLabel}</span>
                    )}
                    {/* Hover tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 hidden group-hover:block">
                      <div className="bg-gray-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg max-w-[220px] text-center">
                        <div className="font-semibold">{c.cleanerName ?? 'Unknown'}</div>
                        {c.isAvailable ? (
                          <div className="text-emerald-300">✅ Available · up to {jobLabel}</div>
                        ) : (
                          <div className="text-red-300">❌ Not available</div>
                        )}
                        {c.note && <div className="text-gray-300 mt-0.5 text-[10px] whitespace-normal">{c.note}</div>}
                        <div className="text-gray-400 text-[10px] mt-0.5">
                          {c.submittedAt ? new Date(c.submittedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) : ''}
                        </div>
                      </div>
                      <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
                    </div>
                  </div>
                );
              })}
            </div>
            {(() => {
              const activeTeamCount = teams.filter(t => t.isActive).length;
              const notResponded = activeTeamCount - checkins.length;
              return notResponded > 0 ? (
                <span className="ml-auto text-[10px] text-amber-500 font-medium">{notResponded} not responded</span>
              ) : (
                <span className="ml-auto text-[10px] text-emerald-500 font-medium">All responded ✅</span>
              );
            })()}
          </div>
        </div>
      )}

      {/* Suggest Slot panel */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
          <span className="text-sm font-medium text-gray-700 shrink-0">Find best slot</span>
          <div className="relative flex-1">
            <input
              ref={suggestRef}
              type="text"
              value={suggestInput}
              onChange={e => setSuggestInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && suggestInput.trim()) setSuggestAddress(suggestInput.trim()); }}
              placeholder="Enter customer address…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 bg-gray-50"
            />
            {suggestFetching && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-gray-400" />
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-xs"
            disabled={!suggestInput.trim() || suggestFetching}
            onClick={() => setSuggestAddress(suggestInput.trim())}
          >
            Search
          </Button>
          {suggestAddress && (
            <button
              className="shrink-0 text-gray-400 hover:text-gray-600"
              onClick={() => { setSuggestInput(""); setSuggestAddress(""); }}
              title="Clear"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results */}
        {suggestData && suggestData.slots.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wide mb-1">
              Best slots for {suggestData.geocodedAddress}
            </div>
            {suggestData.slots.map((slot, i) => (
              <div
                key={slot.teamId}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: slot.teamColor }}
                />
                <span className="text-sm font-medium text-gray-800 flex-1 truncate">{slot.teamName}</span>
                {slot.suggestedTimeMs && (
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(slot.suggestedTimeMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  i === 0 ? 'bg-green-50 text-green-700 border border-green-200' :
                  i === 1 ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                  'bg-gray-100 text-gray-500 border border-gray-200'
                }`}>
                  +{Math.round(slot.addedDriveSecs / 60)} min drive
                </span>
                <span className="text-[10px] text-gray-400">{slot.totalTeamJobs} jobs</span>
              </div>
            ))}
          </div>
        )}
        {suggestData && suggestData.slots.length === 0 && (
          <div className="mt-2 text-sm text-gray-400">No available teams for this date.</div>
        )}
      </div>

      {/* Main content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : activeJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
            <MapPin className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium">No jobs on {formatDate(date)}</p>
          <p className="text-gray-400 text-sm mt-1">Try a different date or sync Launch27</p>
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* Left: team job lists — scrolls naturally with the page */}
          <div className="w-96 shrink-0 flex flex-col gap-3 pr-1">
            {teams.filter(t => t.isActive).map(team => {
              const teamJobs = teamGroups.get(team.id) ?? [];
              const totalHours = teamJobs.reduce((s, j) => {
                const dur = j.assignment?.estimatedDepartureMs && j.assignment?.estimatedArrivalMs
                  ? (j.assignment.estimatedDepartureMs - j.assignment.estimatedArrivalMs) / 3600000
                  : 2;
                return s + dur;
              }, 0);
              const totalDriveSecs = teamJobs.reduce((s, j) => s + (j.assignment?.driveTimeSecs ?? 0), 0);
              const driveLabel = totalDriveSecs > 0
                ? totalDriveSecs >= 3600
                  ? `${(totalDriveSecs / 3600).toFixed(1)}h driving`
                  : `${Math.round(totalDriveSecs / 60)}m driving`
                : null;

              const isUnavailable = unavailableSet.has(team.id);
              const isTeamLocked = lockedTeamSet.has(team.id);
              const teamConflictCount = teamJobs.filter(j => conflictJobIds.has(j.id)).length;
              const teamCheckin = checkins.find(c => (c.cleanerName ?? '').toLowerCase() === team.name.toLowerCase());
              return (
                <div key={team.id} className={`bg-white rounded-xl border overflow-hidden transition-opacity ${isUnavailable ? "opacity-50 border-red-200" : "border-gray-100"}`}>
                  {/* Team header — clean row with popup for details/controls */}
                  <TeamHeaderRow
                    team={team}
                    isUnavailable={isUnavailable}
                    isTeamLocked={isTeamLocked}
                    teamConflictCount={teamConflictCount}
                    teamCheckin={teamCheckin ?? null}
                    driveLabel={driveLabel}
                    recalculating={recalculatingTeams.has(team.id)}
                    date={date}
                    onMarkUnavailable={() => setUnavailable.mutate({ teamId: team.id, date })}
                    onMarkAvailable={() => setAvailable.mutate({ teamId: team.id, date })}
                    onLockTeam={() => lockTeam.mutate({ teamId: team.id, date })}
                    onUnlockTeam={() => unlockTeam.mutate({ teamId: team.id, date })}
                    onSaveLimits={(minJobs, maxJobs, earliestStartTime) =>
                      setTeamLimits.mutate({ teamId: team.id, minJobs, maxJobs, earliestStartTime })
                    }
                    onSaveTag={(tag) => setTeamTag.mutate({ teamId: team.id, tag })}
                    onSaveRegionTags={(regionTags) => setTeamRegionTags.mutate({ teamId: team.id, regionTags })}
                  />
                  {/* Jobs */}
                  <div className="p-2 space-y-1.5">
                    {teamJobs.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3">No jobs assigned</p>
                    ) : (
                      teamJobs.map((job, idx) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          teams={teams}
                          date={date}
                          isSelected={selectedJobId === job.id}
                          onSelect={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
                          isLocked={lockedJobIds.has(job.id)}
                          hasConflict={conflictJobIds.has(job.id)}
                          homeDriveTimeSecs={idx === 0 ? (team as any).homeDriveTimeSecs ?? null : null}
                          isLastJob={idx === teamJobs.length - 1}
                          onIssueClick={() => setIssueDialogJob({ id: job.id, date })}
                          onLockToggle={(locked, position) => {
                            if (locked) {
                              unlockJob.mutate({ jobId: job.id, date });
                            } else {
                              const pos = job.assignment?.routeOrder ?? 0;
                              const cleanerId = job.assignment?.teamId ?? 0;
                              lockJob.mutate({ jobId: job.id, date, cleanerId, lockedPosition: position ?? pos });
                            }
                          }}
                          onReassignStart={(destId, srcId) => {
                            const ids = [destId, ...(srcId ? [srcId] : [])].filter(Boolean) as number[];
                            markRecalculating(ids);
                          }}
                          onReassignDone={(destId, srcId) => {
                            const ids = [destId, ...(srcId ? [srcId] : [])].filter(Boolean) as number[];
                            clearRecalculating(ids);
                          }}
                          onUnassignStart={(srcId) => { if (srcId) markRecalculating([srcId]); }}
                          onUnassignDone={(srcId) => { if (srcId) clearRecalculating([srcId]); }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}

            {/* Unassigned jobs */}
            {unassigned.length > 0 && (
              <div className="bg-amber-50 rounded-xl border border-amber-100 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber-100">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="font-semibold text-sm text-amber-700">Unassigned ({unassigned.length})</span>
                </div>
                <div className="p-2 space-y-1.5">
                  {unassigned.map(job => (
                    <JobCard
                      key={job.id}
                      job={job}
                      teams={teams}
                      date={date}
                      isSelected={selectedJobId === job.id}
                      onSelect={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {teams.length === 0 && (
              <div className="bg-blue-50 rounded-xl p-4 text-center">
                <p className="text-sm text-blue-700 font-medium">No active teams</p>
                <p className="text-xs text-blue-500 mt-1">Teams are auto-synced from Launch27. Click "Teams" to manage them.</p>
              </div>
            )}
          </div>

          {/* Right: map — sticky so it stays visible while scrolling job list */}
          <div className="flex-1 min-w-0 sticky top-4" style={{ height: 420 }}>
            <div className="w-full h-full rounded-xl overflow-hidden border border-gray-100 shadow-sm">
              <ScheduleMap
                jobs={jobs}
                teams={teams}
                selectedJobId={selectedJobId}
                onJobSelect={setSelectedJobId}
              />
            </div>
          </div>
        </div>
      )}

      {/* AI Call Command Center — Issue Dialog */}
      {issueDialogJob && (
        <IssueDialog
          open={!!issueDialogJob}
          onClose={() => setIssueDialogJob(null)}
          cleanerJobId={issueDialogJob.id}
          jobDate={issueDialogJob.date}
          onCallFired={() => setCallLogOpen(true)}
        />
      )}

      {/* AI Call Command Center — Call Log Panel */}
      <CallLogPanel
        open={callLogOpen}
        onClose={() => setCallLogOpen(false)}
        jobDate={date}
      />
    </div>
  );
}

// ── Team List (inside sheet) ──────────────────────────────────────────────────

function TeamList({ onEdit }: { onEdit: (t: Team) => void }) {
  const utils = trpc.useUtils();
  const { data: teams = [] } = trpc.scheduling.getTeams.useQuery();

  const deleteTeam = trpc.scheduling.deleteTeam.useMutation({
    onSuccess: () => { utils.scheduling.getTeams.invalidate(); toast.success("Team removed"); },
    onError: (e) => toast.error(e.message),
  });

  if (teams.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No teams yet — add one above</p>;
  }

  return (
    <div className="space-y-2">
      {teams.map((t: Team) => (
        <div key={t.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color ?? "#6366f1" }} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-gray-900">{t.name}</div>
            {t.homeAddress && (
              <div className="text-xs text-gray-400 truncate">{t.homeAddress}</div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(t as Team)} className="p-1.5 rounded hover:bg-gray-100">
              <Pencil className="w-3.5 h-3.5 text-gray-400" />
            </button>
            <button
              onClick={() => { if (confirm(`Remove ${t.name}?`)) deleteTeam.mutate({ id: t.id }); }}
              className="p-1.5 rounded hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
