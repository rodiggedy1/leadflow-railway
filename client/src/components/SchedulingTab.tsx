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
  GripVertical, RotateCcw,
} from "lucide-react";

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
  assignment: {
    teamId: number;
    teamName: string | null;
    routeOrder: number;
    estimatedArrivalMs: number | null;
    estimatedDepartureMs: number | null;
    driveTimeSecs: number | null;
    isManual: number;
  } | null;
}

// ── Team colors ───────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const totalMins = Math.floor(ms / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
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
  job, teams, date, isSelected, onSelect,
}: {
  job: Job;
  teams: Team[];
  date: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const utils = trpc.useUtils();
  const [showReassign, setShowReassign] = useState(false);

  const manualAssign = trpc.scheduling.manualAssign.useMutation({
    onSuccess: () => {
      utils.scheduling.getSchedule.invalidate({ date });
      setShowReassign(false);
      toast.success("Job reassigned");
    },
    onError: (e) => toast.error(e.message),
  });

  const a = job.assignment;
  const arrivalStr = formatTime(a?.estimatedArrivalMs);
  const driveStr = formatDrive(a?.driveTimeSecs);

  return (
    <>
      <div
        onClick={onSelect}
        className={`group relative bg-white rounded-xl border transition-all cursor-pointer hover:shadow-md ${
          isSelected ? "border-indigo-400 shadow-md ring-1 ring-indigo-200" : "border-gray-100 hover:border-gray-200"
        }`}
      >
        <div className="p-3">
          <div className="flex items-start gap-2">
            <GripVertical className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-medium text-sm text-gray-900 truncate">{job.customerName ?? "Unknown"}</span>
                {a?.isManual === 1 && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-amber-300 text-amber-600">Manual</Badge>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{job.jobAddress ?? "No address"}</span>
              </div>
              {job.serviceType && (
                <div className="text-xs text-gray-400 mt-0.5 truncate">{job.serviceType}</div>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                {arrivalStr !== "—" && (
                  <div className="flex items-center gap-1 text-xs text-indigo-600 font-medium">
                    <Clock className="w-3 h-3" />
                    {arrivalStr}
                  </div>
                )}
                {driveStr && (
                  <div className="text-xs text-gray-400">{driveStr}</div>
                )}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setShowReassign(true); }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 transition-all"
              title="Reassign team"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      <Dialog open={showReassign} onOpenChange={setShowReassign}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reassign Job</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">{job.customerName} — {job.jobAddress}</p>
          <div className="space-y-2 mt-2">
            {teams.filter(t => t.isActive).map(t => (
              <button
                key={t.id}
                onClick={() => manualAssign.mutate({ date, cleanerJobId: job.id, teamId: t.id })}
                disabled={manualAssign.isPending}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-all text-left"
              >
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color ?? "#6366f1" }} />
                <span className="text-sm font-medium">{t.name}</span>
                {a?.teamId === t.id && <Badge variant="outline" className="ml-auto text-xs">Current</Badge>}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassign(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
        // We need lat/lng — geocoding is server-side, so we use a placeholder
        // In practice the map shows markers only for jobs with geocoded coords.
        // We'll use the Geocoder client-side for display purposes.
        if (!job.jobAddress) continue;

        // Use Geocoder to get position for display
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: job.jobAddress }, (results, status) => {
          if (status !== "OK" || !results?.[0]) return;
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
                ${job.assignment?.estimatedArrivalMs ? `<div style="color:#6366f1;font-size:12px;margin-top:4px">ETA: ${formatTime(job.assignment.estimatedArrivalMs)}</div>` : ""}
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

          if (hasPoints && mapRef.current) {
            mapRef.current.fitBounds(bounds, 60);
          }
        });
      }
    }

    // If no assignments yet, show all job addresses
    if (byTeam.size === 0) {
      const geocoder = new google.maps.Geocoder();
      for (const job of jobs.slice(0, 20)) {
        if (!job.jobAddress) continue;
        geocoder.geocode({ address: job.jobAddress }, (results, status) => {
          if (status !== "OK" || !results?.[0]) return;
          const pos = results[0].geometry.location;
          bounds.extend(pos);
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
          if (mapRef.current) mapRef.current.fitBounds(bounds, 60);
        });
      }
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

  const { data, isLoading, refetch } = trpc.scheduling.getSchedule.useQuery(
    { date },
    { staleTime: 30_000, refetchOnWindowFocus: false }
  );

  const optimize = trpc.scheduling.optimizeDay.useMutation({
    onSuccess: (result) => {
      utils.scheduling.getSchedule.invalidate({ date });
      toast.success(result.message);
    },
    onError: (e) => toast.error(e.message),
  });

  const jobs: Job[] = (data?.jobs ?? []) as Job[];
  const teams: Team[] = (data?.teams ?? []) as Team[];
  const hasAssignments = data?.hasAssignments ?? false;

  // Group jobs by assigned team
  const teamGroups = new Map<number | null, Job[]>();
  teamGroups.set(null, []);
  for (const t of teams) teamGroups.set(t.id, []);
  for (const job of jobs) {
    const tid = job.assignment?.teamId ?? null;
    if (!teamGroups.has(tid)) teamGroups.set(tid, []);
    teamGroups.get(tid)!.push(job);
  }
  // Sort each group by routeOrder
  for (const [, group] of Array.from(teamGroups.entries())) {
    group.sort((a, b) => (a.assignment?.routeOrder ?? 999) - (b.assignment?.routeOrder ?? 999));
  }

  const unassigned = teamGroups.get(null) ?? [];
  const activeJobs = jobs.filter(j => j.bookingStatus !== "cancelled");

  return (
    <div className="flex flex-col gap-4 h-full">
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
        <div className="flex gap-4 flex-1 min-h-0" style={{ height: "calc(100vh - 280px)" }}>
          {/* Left: team job lists */}
          <div className="w-96 shrink-0 flex flex-col gap-3 overflow-y-auto pr-1">
            {teams.filter(t => t.isActive).map(team => {
              const teamJobs = teamGroups.get(team.id) ?? [];
              const totalHours = teamJobs.reduce((s, j) => {
                const dur = j.assignment?.estimatedDepartureMs && j.assignment?.estimatedArrivalMs
                  ? (j.assignment.estimatedDepartureMs - j.assignment.estimatedArrivalMs) / 3600000
                  : 2;
                return s + dur;
              }, 0);

              return (
                <div key={team.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {/* Team header */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-50">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color ?? "#6366f1" }} />
                    <span className="font-semibold text-sm text-gray-900">{team.name}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-gray-400">{teamJobs.length} jobs · {totalHours.toFixed(1)}h</span>
                      {team.homeAddress && (
                        <span title={team.homeAddress ?? undefined}><Home className="w-3 h-3 text-gray-300" /></span>
                      )}
                    </div>
                  </div>
                  {/* Jobs */}
                  <div className="p-2 space-y-1.5">
                    {teamJobs.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3">No jobs assigned</p>
                    ) : (
                      teamJobs.map(job => (
                        <JobCard
                          key={job.id}
                          job={job}
                          teams={teams}
                          date={date}
                          isSelected={selectedJobId === job.id}
                          onSelect={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
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

          {/* Right: map */}
          <div className="flex-1 min-w-0 rounded-xl overflow-hidden border border-gray-100 shadow-sm">
            <ScheduleMap
              jobs={jobs}
              teams={teams}
              selectedJobId={selectedJobId}
              onJobSelect={setSelectedJobId}
            />
          </div>
        </div>
      )}
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
