import React, { useState, useMemo, useContext } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Phone,
  ShieldAlert,
  Star,
  Trophy,
  Users,
  Wrench,
  X,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import AdminPageGuard from '@/components/AdminPageGuard';
import { trpc } from '@/lib/trpc';

// ─── Date helpers (Sun–Sat pay week) ─────────────────────────────────────────

function getPayWeekStart(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtWeekLabel(start: Date): string {
  const end = addDays(start, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type TeamStatus = 'Top performer' | 'Stable' | 'Needs attention' | 'At risk';

// Infer from tRPC response
type TeamRow = NonNullable<ReturnType<typeof useTeamPayQuery>['data']>['teams'][number];
type JobRow = TeamRow['jobs'][number];

// ─── Icon map (avoids passing React elements over tRPC) ───────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Clock3,
  AlertTriangle,
  Star,
  Camera,
  ShieldAlert,
  Wrench,
  ArrowUpRight,
  Trophy,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const statusStyles: Record<TeamStatus, string> = {
  'Top performer': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Stable: 'bg-slate-100 text-slate-700 border-slate-200',
  'Needs attention': 'bg-amber-50 text-amber-700 border-amber-200',
  'At risk': 'bg-rose-50 text-rose-700 border-rose-200',
};

function cx(...arr: (string | false | null | undefined)[]) {
  return arr.filter(Boolean).join(' ');
}

// ─── tRPC query hook ──────────────────────────────────────────────────────────

function useTeamPayQuery(weekStart: string) {
  return trpc.teamPay.getTeams.useQuery({ weekStart }, { staleTime: 60_000 });
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function KPI({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="rounded-3xl border-0 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
            {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
          </div>
          <div className="rounded-2xl bg-slate-100 p-3">
            <Icon className="h-5 w-5 text-slate-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  label,
  value,
  iconKey,
  positive,
}: {
  label: string;
  value: number;
  iconKey: string;
  positive?: boolean;
}) {
  const Icon = ICON_MAP[iconKey] ?? AlertTriangle;
  return (
    <div
      className={cx(
        'flex items-center justify-between rounded-3xl border p-4',
        positive ? 'border-emerald-200 bg-emerald-50' : 'border-rose-100 bg-rose-50'
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cx(
            'rounded-2xl p-2',
            positive ? 'bg-emerald-100' : 'bg-rose-100'
          )}
        >
          <Icon
            className={cx('h-4 w-4', positive ? 'text-emerald-700' : 'text-rose-700')}
          />
        </div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
      </div>
      <div
        className={cx(
          'text-sm font-semibold',
          positive ? 'text-emerald-700' : 'text-rose-700'
        )}
      >
        {value > 0 ? '+' : ''}
        {value}%
      </div>
    </div>
  );
}

// ─── Cleaner View Overlay ─────────────────────────────────────────────────────

function CleanerView({
  team,
  onClose,
}: {
  team: TeamRow;
  onClose: () => void;
}) {
  const teamJobs = team.jobs;
  const [selectedJobId, setSelectedJobId] = useState(teamJobs[0]?.id ?? '');
  const activeJob = useMemo(
    () => teamJobs.find((j) => j.id === selectedJobId) ?? teamJobs[0] ?? null,
    [selectedJobId, teamJobs]
  );

  return (
    <AnimatePresence>
      <motion.div
        key="cleaner-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 overflow-y-auto bg-[radial-gradient(circle_at_top,_#f8fafc,_#eef2f7_55%,_#e8edf5)]"
      >
        <div className="mx-auto max-w-6xl p-6 md:p-8">
          {/* Header */}
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
                Cleaner Performance Page
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                Show the consequence right after the job.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
                Live score movement, payout breakdown, and next best action.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="rounded-2xl px-5">
                Share preview
              </Button>
              <Button className="rounded-2xl px-5">Send to team</Button>
              <Button
                variant="outline"
                className="rounded-2xl px-4"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            {/* Left: job list */}
            <Card className="rounded-[32px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">Jobs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {teamJobs.length === 0 ? (
                  <p className="text-sm text-slate-500">No jobs this week.</p>
                ) : (
                  teamJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={cx(
                        'w-full rounded-3xl border px-4 py-4 text-left transition',
                        activeJob?.id === job.id
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      )}
                    >
                      <div className="text-sm font-semibold">{job.customer}</div>
                      <div
                        className={cx(
                          'mt-1 text-xs',
                          activeJob?.id === job.id ? 'text-slate-300' : 'text-slate-500'
                        )}
                      >
                        {job.area} • {job.time}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div
                          className={cx(
                            'text-sm font-semibold',
                            job.weeklyImpact >= 0
                              ? 'text-emerald-600'
                              : activeJob?.id === job.id
                              ? 'text-rose-300'
                              : 'text-rose-600'
                          )}
                        >
                          {job.weeklyImpact > 0 ? '+' : ''}
                          {job.weeklyImpact}%
                        </div>
                        <div
                          className={cx(
                            'text-sm font-semibold',
                            job.instantImpact >= 0
                              ? 'text-emerald-600'
                              : activeJob?.id === job.id
                              ? 'text-rose-300'
                              : 'text-rose-600'
                          )}
                        >
                          {job.instantImpact > 0 ? '+' : ''}${job.instantImpact}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Right: detail */}
            {activeJob ? (
              <div className="space-y-6">
                {/* Score hero */}
                <Card className="rounded-[32px] border-0 bg-slate-950 text-white shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm text-slate-400">{team.name}</div>
                        <h2 className="mt-2 text-3xl font-semibold">Your score just updated</h2>
                        <p className="mt-2 text-sm text-slate-300">
                          {activeJob.customer} • {activeJob.service}
                        </p>
                      </div>
                      <Badge className="rounded-full bg-white/10 text-white">Job completed</Badge>
                    </div>
                    <div className="mt-6 grid grid-cols-3 gap-3">
                      <div className="rounded-3xl bg-white/10 p-4">
                        <div className="text-xs text-slate-400">Score</div>
                        <div className="mt-2 text-3xl font-semibold">{team.currentScore}%</div>
                        <div
                          className={cx(
                            'mt-2 text-xs font-medium',
                            activeJob.weeklyImpact >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          )}
                        >
                          {activeJob.weeklyImpact > 0 ? '+' : ''}
                          {activeJob.weeklyImpact}% from this job
                        </div>
                      </div>
                      <div className="rounded-3xl bg-white/10 p-4">
                        <div className="text-xs text-slate-400">Base pay</div>
                        <div className="mt-2 text-3xl font-semibold">${activeJob.baseTeamPay}</div>
                        <div className="mt-2 text-xs text-slate-400">Before adjustments</div>
                      </div>
                      <div className="rounded-3xl bg-white/10 p-4">
                        <div className="text-xs text-slate-400">Final payout</div>
                        <div className="mt-2 text-3xl font-semibold">${activeJob.finalTeamPay}</div>
                        <div
                          className={cx(
                            'mt-2 text-xs font-medium',
                            activeJob.instantImpact >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          )}
                        >
                          {activeJob.instantImpact > 0 ? '+' : ''}${activeJob.instantImpact} total adjustment
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Breakdown + Next best action */}
                <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                  <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-xl">Payout breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-3xl bg-slate-50 p-5">
                        <div className="flex items-end justify-between">
                          <div>
                            <div className="text-sm text-slate-500">Base pay</div>
                            <div className="mt-1 text-3xl font-semibold text-slate-950">
                              ${activeJob.baseTeamPay}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-slate-500">Final payout</div>
                            <div className="mt-1 text-4xl font-semibold tracking-tight text-slate-950">
                              ${activeJob.finalTeamPay}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm text-slate-600">Net adjustment</div>
                            <div
                              className={cx(
                                'text-sm font-semibold',
                                activeJob.instantImpact >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              )}
                            >
                              {activeJob.instantImpact > 0 ? '+' : ''}${activeJob.instantImpact}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-6 space-y-3">
                        {activeJob.items.length === 0 ? (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                            No adjustments on this job.
                          </div>
                        ) : (
                          activeJob.items.map((item, i) => (
                            <div
                              key={i}
                              className="rounded-3xl border border-slate-200 p-4 flex items-center justify-between gap-4"
                            >
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                                <div className="text-xs text-slate-500">
                                  {item.amount < 0 ? 'Reduced payout on this job' : 'Increased payout on this job'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div
                                  className={cx(
                                    'text-sm font-semibold',
                                    item.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                  )}
                                >
                                  {item.amount > 0 ? '+' : ''}${item.amount}
                                </div>
                                <div
                                  className={cx(
                                    'text-xs',
                                    item.weekly >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                  )}
                                >
                                  {item.weekly > 0 ? '+' : ''}
                                  {item.weekly}% weekly
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-xl">Next best action</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs text-slate-500">Recovery plan</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">
                          {team.recovery[0]}
                        </div>
                      </div>
                      <div className="rounded-3xl border border-slate-200 p-4">
                        <div className="text-xs text-slate-500">Review outcome</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">
                          {activeJob.customerRating !== null
                            ? `${activeJob.customerRating}-star review`
                            : 'No review yet'}
                        </div>
                      </div>
                      <div className="rounded-3xl border border-slate-200 p-4">
                        <div className="text-xs text-slate-500">Photos / QA</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">
                          {activeJob.photoSubmitted ? 'Photo submitted ✓' : 'Photo not submitted'}
                        </div>
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs text-slate-500">Next week payout pace</div>
                        <div className="mt-2 text-2xl font-semibold text-slate-950">
                          {team.nextWeekPayout}%
                        </div>
                      </div>
                      <Button className="w-full rounded-2xl">Open my score plan</Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-[32px] bg-white/60 p-12 text-slate-400">
                No jobs recorded for this team yet.
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Team Card ────────────────────────────────────────────────────────────────

function TeamCard({
  team,
  selected,
  onSelect,
  onCleanerView,
}: {
  team: TeamRow;
  selected: boolean;
  onSelect: () => void;
  onCleanerView: () => void;
}) {
  const payoutDiff = (team.nextWeekPayout - team.basePayout).toFixed(1);
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.995 }}
      onClick={onSelect}
      className={cx(
        'w-full rounded-[28px] border p-5 text-left transition-all shadow-sm',
        selected
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white hover:border-slate-300'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={cx(
              'h-11 w-11 rounded-2xl flex items-center justify-center font-semibold shrink-0',
              selected ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-900'
            )}
          >
            {team.name
              .split(' ')
              .map((x) => x[0])
              .join('')
              .slice(0, 2)}
          </div>
          <div>
            <div className="font-semibold">{team.name}</div>
            <div
              className={cx(
                'mt-0.5 text-xs',
                selected ? 'text-slate-300' : 'text-slate-500'
              )}
            >
              {team.jobsThisWeek} job{team.jobsThisWeek !== 1 ? 's' : ''} this week
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge
            className={cx(
              'rounded-full border px-3 py-1 text-xs font-medium',
              selected ? 'bg-white/10 text-white border-white/20' : statusStyles[team.status as TeamStatus]
            )}
          >
            {team.status}
          </Badge>
          <div
            className={cx(
              'text-xs font-medium',
              selected
                ? team.weeklyDelta >= 0
                  ? 'text-emerald-300'
                  : 'text-rose-300'
                : team.weeklyDelta >= 0
                ? 'text-emerald-600'
                : 'text-rose-600'
            )}
          >
            {team.weeklyDelta > 0 ? '+' : ''}
            {payoutDiff}% payout
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className={cx('rounded-2xl p-3', selected ? 'bg-white/5' : 'bg-slate-50')}>
          <div className={cx('text-[11px]', selected ? 'text-slate-400' : 'text-slate-500')}>Score</div>
          <div className="mt-1 text-lg font-semibold">{team.currentScore}%</div>
        </div>
        <div className={cx('rounded-2xl p-3', selected ? 'bg-white/5' : 'bg-slate-50')}>
          <div className={cx('text-[11px]', selected ? 'text-slate-400' : 'text-slate-500')}>5-star</div>
          <div className="mt-1 text-lg font-semibold">{team.fiveStarRate}%</div>
        </div>
        <div className={cx('rounded-2xl p-3', selected ? 'bg-white/5' : 'bg-slate-50')}>
          <div className={cx('text-[11px]', selected ? 'text-slate-400' : 'text-slate-500')}>Issues</div>
          <div
            className={cx(
              'mt-1 text-lg font-semibold',
              team.issues > 0
                ? selected
                  ? 'text-rose-300'
                  : 'text-rose-600'
                : ''
            )}
          >
            {team.issues}
          </div>
        </div>
      </div>

      {/* Cleaner view button */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCleanerView();
          }}
          className={cx(
            'flex items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs font-medium transition',
            selected
              ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Cleaner view
        </button>
      </div>
    </motion.button>
  );
}

// ─── Simple Tabs ──────────────────────────────────────────────────────────────

const TabsContext = React.createContext<{ active: string; setActive: (v: string) => void }>({
  active: '',
  setActive: () => {},
});

function SimpleTabsRoot({
  defaultTab,
  className,
  children,
}: {
  defaultTab: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(defaultTab);
  return (
    <TabsContext.Provider value={{ active, setActive }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

function SimpleTabsList({
  tabs,
}: {
  tabs: Array<{ value: string; label: string }>;
}) {
  const { active, setActive } = useContext(TabsContext);
  return (
    <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => setActive(tab.value)}
          className={cx(
            'rounded-xl px-4 py-2 text-sm font-medium transition-all',
            active === tab.value
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SimpleTabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { active } = useContext(TabsContext);
  if (active !== value) return null;
  return <div className={className}>{children}</div>;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

function TeamPayContent() {
  // Week navigation state — default to current Sun–Sat pay week
  const [weekStart, setWeekStart] = useState(() => fmtDate(getPayWeekStart(new Date())));

  const { data, isLoading, error } = useTeamPayQuery(weekStart);

  const teams = data?.teams ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [cleanerViewTeamId, setCleanerViewTeamId] = useState<number | null>(null);

  // When data loads, default-select the first team
  const effectiveSelectedId = selectedId ?? (teams[0]?.id ?? null);

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === effectiveSelectedId) ?? teams[0] ?? null,
    [teams, effectiveSelectedId]
  );

  const cleanerViewTeam = useMemo(
    () => (cleanerViewTeamId !== null ? teams.find((t) => t.id === cleanerViewTeamId) ?? null : null),
    [cleanerViewTeamId, teams]
  );

  const teamJobs = selectedTeam?.jobs ?? [];

  const effectiveJobId = selectedJobId || (teamJobs[0]?.id ?? '');
  const activeJob = teamJobs.find((j) => j.id === effectiveJobId) ?? teamJobs[0] ?? null;

  // Reset job selection when team changes
  React.useEffect(() => {
    setSelectedJobId('');
  }, [effectiveSelectedId]);

  // Reset team selection when week changes
  React.useEffect(() => {
    setSelectedId(null);
    setSelectedJobId('');
  }, [weekStart]);

  const summary = useMemo(() => {
    if (teams.length === 0) return { avgScore: 0, totalIssues: 0, riskTeams: 0, avgPayout: '0' };
    const avgScore = Math.round(teams.reduce((a, b) => a + b.currentScore, 0) / teams.length);
    const totalIssues = teams.reduce((a, b) => a + b.issues, 0);
    const riskTeams = teams.filter((t) => t.status === 'At risk' || t.status === 'Needs attention').length;
    const avgPayout = (teams.reduce((a, b) => a + b.nextWeekPayout, 0) / teams.length).toFixed(1);
    return { avgScore, totalIssues, riskTeams, avgPayout };
  }, [teams]);

  // Week navigation
  const prevWeek = () => setWeekStart(fmtDate(addDays(new Date(weekStart + 'T00:00:00'), -7)));
  const nextWeek = () => {
    const next = addDays(new Date(weekStart + 'T00:00:00'), 7);
    if (next <= new Date()) setWeekStart(fmtDate(next));
  };
  const isCurrentWeek = weekStart === fmtDate(getPayWeekStart(new Date()));

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#eef2f7_55%,_#e8edf5)] p-6 text-slate-900 md:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Page header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
              Weekly Performance Engine
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              Team pay tied to behavior.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
              Late check-ins, issues, photo misses, and bad reviews reduce next week's payout.
              Strong execution, recurring conversions, and review wins restore it.
            </p>
          </div>
          <div className="flex gap-3">
            <Button className="rounded-2xl px-5">Adjust rules</Button>
            <Button variant="outline" className="rounded-2xl px-5">
              Export weekly report
            </Button>
          </div>
        </div>

        {/* Week picker */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={prevWeek}
            className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
            Pay week: {fmtWeekLabel(new Date(weekStart + 'T00:00:00'))}
            {isCurrentWeek && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                Current
              </span>
            )}
          </div>
          <button
            onClick={nextWeek}
            disabled={isCurrentWeek}
            className={cx(
              'flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm transition',
              isCurrentWeek ? 'opacity-30 cursor-not-allowed' : 'hover:border-slate-300'
            )}
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
            Failed to load team data. Please try again.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && teams.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center text-slate-500">
            No team data found for this pay week.
          </div>
        )}

        {/* Main content */}
        {!isLoading && !error && teams.length > 0 && (
          <>
            {/* KPI row */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KPI
                label="Average team score"
                value={`${summary.avgScore}%`}
                sub="Rolling weekly score"
                icon={Users}
              />
              <KPI
                label="Next week avg payout"
                value={`${summary.avgPayout}%`}
                sub="Based on current performance"
                icon={ArrowUpRight}
              />
              <KPI
                label="Open quality issues"
                value={summary.totalIssues}
                sub="Across all active teams"
                icon={Wrench}
              />
              <KPI
                label="Teams at risk"
                value={summary.riskTeams}
                sub="Require coaching or intervention"
                icon={AlertTriangle}
              />
            </div>

            {/* Leaderboard + detail */}
            <div className="mt-6 grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
              {/* Left: team leaderboard */}
              <Card className="rounded-[32px] border-0 bg-white/80 shadow-sm backdrop-blur">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">Team leaderboard</CardTitle>
                    <Badge className="rounded-full bg-slate-900 px-3 py-1 text-white">
                      {isCurrentWeek ? 'Live this week' : 'Historical'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {teams.map((team) => (
                    <TeamCard
                      key={team.id}
                      team={team}
                      selected={team.id === effectiveSelectedId}
                      onSelect={() => setSelectedId(team.id)}
                      onCleanerView={() => setCleanerViewTeamId(team.id)}
                    />
                  ))}
                </CardContent>
              </Card>

              {/* Right: selected team detail */}
              {selectedTeam && (
                <div className="space-y-6">
                  {/* Hero card */}
                  <Card className="rounded-[32px] border-0 bg-slate-950 text-white shadow-sm overflow-hidden">
                    <CardContent className="p-6 md:p-7">
                      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-lg font-semibold shrink-0">
                              {selectedTeam.name
                                .split(' ')
                                .map((x) => x[0])
                                .join('')
                                .slice(0, 2)}
                            </div>
                            <div>
                              <h2 className="text-2xl font-semibold tracking-tight">
                                {selectedTeam.name}
                              </h2>
                              <p className="mt-1 text-sm text-slate-300">
                                Pay rate: {selectedTeam.payPercent}%
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                            Rank #{selectedTeam.rank} this week
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 md:w-[340px]">
                          <div className="rounded-3xl bg-white/5 p-4">
                            <div className="text-xs text-slate-400">Current score</div>
                            <div className="mt-2 text-3xl font-semibold">
                              {selectedTeam.currentScore}%
                            </div>
                          </div>
                          <div className="rounded-3xl bg-white/5 p-4">
                            <div className="text-xs text-slate-400">Next week pay</div>
                            <div className="mt-2 text-3xl font-semibold">
                              {selectedTeam.nextWeekPayout}%
                            </div>
                          </div>
                          <div className="rounded-3xl bg-white/5 p-4">
                            <div className="text-xs text-slate-400">Jobs this week</div>
                            <div className="mt-2 text-3xl font-semibold">
                              {selectedTeam.jobsThisWeek}
                            </div>
                          </div>
                          <div className="rounded-3xl bg-white/5 p-4">
                            <div className="text-xs text-slate-400">Weekly delta</div>
                            <div
                              className={cx(
                                'mt-2 text-3xl font-semibold',
                                selectedTeam.weeklyDelta >= 0 ? 'text-emerald-400' : 'text-rose-300'
                              )}
                            >
                              {selectedTeam.weeklyDelta > 0 ? '+' : ''}
                              {selectedTeam.weeklyDelta}%
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 grid gap-4 md:grid-cols-4">
                        {[
                          { label: 'On-time rate', value: `${selectedTeam.onTimeRate}%` },
                          { label: '5-star rate', value: `${selectedTeam.fiveStarRate}%` },
                          { label: 'Issues', value: selectedTeam.issues },
                          { label: 'Missed check-ins', value: selectedTeam.missedCheckins },
                        ].map((item) => (
                          <div key={item.label} className="rounded-3xl bg-white/5 p-4">
                            <div className="text-xs text-slate-400">{item.label}</div>
                            <div className="mt-2 text-xl font-semibold">{item.value}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Tabs */}
                  <SimpleTabsRoot defaultTab="breakdown" className="space-y-6">
                    <SimpleTabsList tabs={[
                      { value: 'breakdown', label: 'Breakdown' },
                      { value: 'timeline',  label: 'Timeline' },
                      { value: 'actions',   label: 'Recovery' },
                      { value: 'jobview',   label: 'Job impact' },
                    ]} />

                    {/* Breakdown tab */}
                    <SimpleTabsContent
                      value="breakdown"
                      className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]"
                    >
                      <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">Payout impact</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="rounded-3xl bg-slate-50 p-5">
                            <div className="flex items-end justify-between">
                              <div>
                                <div className="text-sm text-slate-500">Base payout</div>
                                <div className="mt-1 text-3xl font-semibold">
                                  {selectedTeam.basePayout}%
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-slate-500">Projected next week</div>
                                <div className="mt-1 text-4xl font-semibold tracking-tight text-slate-950">
                                  {selectedTeam.nextWeekPayout}%
                                </div>
                              </div>
                            </div>
                            <div className="mt-5">
                              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                                <span>Current score progress</span>
                                <span>{selectedTeam.currentScore}%</span>
                              </div>
                              <Progress
                                value={Math.min(selectedTeam.currentScore, 100)}
                                className="h-3 rounded-full"
                              />
                            </div>
                          </div>

                          <div className="mt-6 space-y-3">
                            {selectedTeam.deductions.length === 0 && selectedTeam.boosts.length === 0 ? (
                              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                                No deductions this week.
                              </div>
                            ) : (
                              <>
                                {selectedTeam.deductions.map((item, i) => (
                                  <BreakdownRow
                                    key={i}
                                    label={item.label}
                                    value={item.value}
                                    iconKey={item.iconKey}
                                  />
                                ))}
                                {selectedTeam.boosts.map((item, i) => (
                                  <BreakdownRow
                                    key={`b-${i}`}
                                    label={item.label}
                                    value={item.value}
                                    iconKey={item.iconKey}
                                    positive
                                  />
                                ))}
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">Risk signals</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {[
                            { label: 'Late check-ins', value: selectedTeam.lateCheckins, tone: 'amber' },
                            { label: 'Missed check-ins', value: selectedTeam.missedCheckins, tone: 'rose' },
                            { label: 'Bad reviews', value: selectedTeam.badReviews, tone: 'rose' },
                            { label: 'Photo misses', value: selectedTeam.photoMisses, tone: 'amber' },
                          ].map((item) => (
                            <div key={item.label} className="rounded-3xl border border-slate-200 p-4">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-slate-700">{item.label}</div>
                                <div
                                  className={cx(
                                    'rounded-full px-3 py-1 text-xs font-semibold',
                                    item.tone === 'rose' && 'bg-rose-50 text-rose-700',
                                    item.tone === 'amber' && 'bg-amber-50 text-amber-700',
                                    item.tone === 'emerald' && 'bg-emerald-50 text-emerald-700'
                                  )}
                                >
                                  {item.value}
                                </div>
                              </div>
                            </div>
                          ))}

                          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-medium text-slate-800">
                              Scheduling priority
                            </div>
                            <div className="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                              <div>
                                <div className="text-xs text-slate-500">Current bucket</div>
                                <div className="mt-1 text-lg font-semibold text-slate-900">
                                  {selectedTeam.currentScore >= 100
                                    ? 'Priority jobs'
                                    : selectedTeam.currentScore >= 90
                                    ? 'Standard assignment'
                                    : 'Restricted / filler slots'}
                                </div>
                              </div>
                              <CheckCircle2 className="h-5 w-5 text-slate-400" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </SimpleTabsContent>

                    {/* Timeline tab */}
                    <SimpleTabsContent value="timeline">
                      <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">Recent performance timeline</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {selectedTeam.recentEvents.map((event, index) => (
                              <div
                                key={index}
                                className="flex gap-4 rounded-3xl border border-slate-200 p-4"
                              >
                                <div className="flex flex-col items-center">
                                  <div
                                    className={cx(
                                      'mt-1 h-3 w-3 rounded-full shrink-0',
                                      event.type === 'positive' && 'bg-emerald-500',
                                      event.type === 'negative' && 'bg-rose-500',
                                      event.type === 'neutral' && 'bg-slate-400'
                                    )}
                                  />
                                  {index !== selectedTeam.recentEvents.length - 1 ? (
                                    <div className="mt-2 h-full w-px bg-slate-200" />
                                  ) : null}
                                </div>
                                <div className="flex-1">
                                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                                    {event.time}
                                  </div>
                                  <div className="mt-1 text-sm font-medium text-slate-800">
                                    {event.text}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </SimpleTabsContent>

                    {/* Recovery tab */}
                    <SimpleTabsContent value="actions" className="grid gap-6 lg:grid-cols-[1fr_340px]">
                      <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">Recovery actions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {selectedTeam.recovery.map((action, i) => (
                            <button
                              key={i}
                              className="flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                            >
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{action}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Trackable by system and visible to ops
                                </div>
                              </div>
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            </button>
                          ))}
                        </CardContent>
                      </Card>

                      <Card className="rounded-[32px] border-0 bg-slate-900 text-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">Ops actions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <Button className="w-full justify-start rounded-2xl bg-white text-slate-900 hover:bg-slate-100">
                            <Phone className="mr-2 h-4 w-4" /> Call team now
                          </Button>
                          <Button
                            variant="secondary"
                            className="w-full justify-start rounded-2xl bg-white/10 text-white hover:bg-white/15"
                          >
                            <AlertTriangle className="mr-2 h-4 w-4" /> Create coaching task
                          </Button>
                          <Button
                            variant="secondary"
                            className="w-full justify-start rounded-2xl bg-white/10 text-white hover:bg-white/15"
                          >
                            <Clock3 className="mr-2 h-4 w-4" /> Tighten check-in threshold
                          </Button>
                          <Button
                            variant="secondary"
                            className="w-full justify-start rounded-2xl bg-white/10 text-white hover:bg-white/15"
                          >
                            <Star className="mr-2 h-4 w-4" /> Review payout override
                          </Button>
                        </CardContent>
                      </Card>
                    </SimpleTabsContent>

                    {/* Job impact tab */}
                    <SimpleTabsContent
                      value="jobview"
                      className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]"
                    >
                      <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">Jobs for selected team</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {teamJobs.map((job) => (
                            <button
                              key={job.id}
                              onClick={() => setSelectedJobId(job.id)}
                              className={cx(
                                'w-full rounded-3xl border px-4 py-4 text-left transition',
                                activeJob?.id === job.id
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold">{job.customer}</div>
                                  <div
                                    className={cx(
                                      'mt-1 text-xs',
                                      activeJob?.id === job.id ? 'text-slate-300' : 'text-slate-500'
                                    )}
                                  >
                                    {job.area} • {job.time}
                                  </div>
                                </div>
                                <Badge
                                  className={cx(
                                    'rounded-full px-3 py-1 shrink-0',
                                    activeJob?.id === job.id
                                      ? 'bg-white/10 text-white'
                                      : 'bg-slate-100 text-slate-700'
                                  )}
                                >
                                  {job.status}
                                </Badge>
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-3">
                                <div>
                                  <div
                                    className={cx(
                                      'text-[11px]',
                                      activeJob?.id === job.id ? 'text-slate-400' : 'text-slate-500'
                                    )}
                                  >
                                    Instant impact
                                  </div>
                                  <div
                                    className={cx(
                                      'mt-1 text-xl font-semibold',
                                      job.instantImpact >= 0
                                        ? 'text-emerald-400'
                                        : activeJob?.id === job.id
                                        ? 'text-rose-300'
                                        : 'text-rose-600'
                                    )}
                                  >
                                    {job.instantImpact > 0 ? '+' : ''}${job.instantImpact}
                                  </div>
                                </div>
                                <div>
                                  <div
                                    className={cx(
                                      'text-[11px]',
                                      activeJob?.id === job.id ? 'text-slate-400' : 'text-slate-500'
                                    )}
                                  >
                                    Weekly impact
                                  </div>
                                  <div
                                    className={cx(
                                      'mt-1 text-xl font-semibold',
                                      job.weeklyImpact >= 0
                                        ? 'text-emerald-400'
                                        : activeJob?.id === job.id
                                        ? 'text-rose-300'
                                        : 'text-rose-600'
                                    )}
                                  >
                                    {job.weeklyImpact > 0 ? '+' : ''}
                                    {job.weeklyImpact}%
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                          {teamJobs.length === 0 && (
                            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                              No jobs recorded for this team yet.
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {activeJob ? (
                        <div className="space-y-6">
                          {/* Job hero */}
                          <Card className="rounded-[32px] border-0 bg-slate-950 text-white shadow-sm overflow-hidden">
                            <CardContent className="p-6 md:p-7">
                              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <div className="text-sm text-slate-400">{activeJob.time}</div>
                                  <h3 className="mt-2 text-3xl font-semibold tracking-tight">
                                    {activeJob.customer}
                                  </h3>
                                  <p className="mt-2 text-sm text-slate-300">
                                    {activeJob.service} • {activeJob.area}
                                  </p>
                                  <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                                    {activeJob.status}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 md:w-[340px]">
                                  <div className="rounded-3xl bg-white/5 p-4">
                                    <div className="text-xs text-slate-400">Instant pay impact</div>
                                    <div
                                      className={cx(
                                        'mt-2 text-3xl font-semibold',
                                        activeJob.instantImpact >= 0 ? 'text-emerald-400' : 'text-rose-300'
                                      )}
                                    >
                                      {activeJob.instantImpact > 0 ? '+' : ''}${activeJob.instantImpact}
                                    </div>
                                  </div>
                                  <div className="rounded-3xl bg-white/5 p-4">
                                    <div className="text-xs text-slate-400">Weekly score impact</div>
                                    <div
                                      className={cx(
                                        'mt-2 text-3xl font-semibold',
                                        activeJob.weeklyImpact >= 0 ? 'text-emerald-400' : 'text-rose-300'
                                      )}
                                    >
                                      {activeJob.weeklyImpact > 0 ? '+' : ''}
                                      {activeJob.weeklyImpact}%
                                    </div>
                                  </div>
                                  <div className="rounded-3xl bg-white/5 p-4">
                                    <div className="text-xs text-slate-400">Base team pay</div>
                                    <div className="mt-2 text-3xl font-semibold">
                                      ${activeJob.baseTeamPay}
                                    </div>
                                  </div>
                                  <div className="rounded-3xl bg-white/5 p-4">
                                    <div className="text-xs text-slate-400">Final team pay</div>
                                    <div className="mt-2 text-3xl font-semibold">
                                      ${activeJob.finalTeamPay}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                            <CardHeader>
                              <CardTitle className="text-xl">What changed on this job</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {activeJob.items.length === 0 ? (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                                  No adjustments on this job.
                                </div>
                              ) : (
                                activeJob.items.map((item, i) => (
                                  <div
                                    key={i}
                                    className="rounded-3xl border border-slate-200 p-4"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <div className="text-sm font-semibold text-slate-900">
                                          {item.label}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500">
                                          Applied automatically from job events
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <div
                                          className={cx(
                                            'text-sm font-semibold',
                                            item.amount >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                          )}
                                        >
                                          {item.amount > 0 ? '+' : ''}${item.amount}
                                        </div>
                                        <div
                                          className={cx(
                                            'mt-1 text-xs font-medium',
                                            item.weekly >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                          )}
                                        >
                                          {item.weekly > 0 ? '+' : ''}
                                          {item.weekly}% weekly
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      ) : null}
                    </SimpleTabsContent>
                  </SimpleTabsRoot>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {cleanerViewTeam && (
        <CleanerView
          team={cleanerViewTeam}
          onClose={() => setCleanerViewTeamId(null)}
        />
      )}
    </div>
  );
}

export default function TeamPay() {
  return (
    <AdminPageGuard pageId="team-pay">
      <TeamPayContent />
    </AdminPageGuard>
  );
}
