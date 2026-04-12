import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Clock3,
  Star,
  Users,
  Wrench,
  Trophy,
  Phone,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import AdminPageGuard from '@/components/AdminPageGuard';

// ─── Static mock data (UI-only, to be replaced when wired to backend) ─────────

const teams = [
  {
    id: 1,
    name: 'Team Alpha',
    members: ['Nina', 'Carlos'],
    currentScore: 93,
    nextWeekPayout: 46.5,
    basePayout: 50,
    weeklyDelta: -7,
    status: 'Needs attention',
    rank: 3,
    jobsThisWeek: 18,
    onTimeRate: 88,
    fiveStarRate: 72,
    issues: 3,
    lateCheckins: 2,
    missedCheckins: 0,
    badReviews: 1,
    photoMisses: 1,
    recurringWins: 2,
    perfectStreak: 0,
    deductions: [
      { label: '2 late check-ins', value: -6, icon: Clock3 },
      { label: '1 customer complaint', value: -5, icon: AlertTriangle },
      { label: '1 bad review', value: -10, icon: Star },
      { label: '1 missing photo', value: -5, icon: Camera },
    ],
    boosts: [
      { label: '2 recurring conversions', value: 6, icon: ArrowUpRight },
      { label: '1 five-star review', value: 2, icon: Trophy },
    ],
    recovery: [
      'Complete next 3 jobs on time → +3%',
      'Get 2 five-star reviews → +4%',
      '7-day photo compliance streak → +2%',
    ],
    recentEvents: [
      { time: 'Mon 9:12 AM', text: 'Late check-in at Dupont Circle', type: 'negative' },
      { time: 'Tue 2:10 PM', text: '5-star review from Adams Morgan clean', type: 'positive' },
      { time: 'Wed 1:42 PM', text: 'Complaint: missed baseboards', type: 'negative' },
      { time: 'Thu 10:05 AM', text: 'Recurring plan upsell closed', type: 'positive' },
    ],
  },
  {
    id: 2,
    name: 'Team Nova',
    members: ['Amber', 'Joel'],
    currentScore: 104,
    nextWeekPayout: 52,
    basePayout: 50,
    weeklyDelta: 4,
    status: 'Top performer',
    rank: 1,
    jobsThisWeek: 22,
    onTimeRate: 98,
    fiveStarRate: 91,
    issues: 0,
    lateCheckins: 0,
    missedCheckins: 0,
    badReviews: 0,
    photoMisses: 0,
    recurringWins: 3,
    perfectStreak: 1,
    deductions: [],
    boosts: [
      { label: '3 recurring conversions', value: 9, icon: ArrowUpRight },
      { label: '5-job on-time streak', value: 5, icon: Trophy },
      { label: '3 five-star reviews', value: 6, icon: Star },
    ],
    recovery: [
      'Maintain perfect check-ins this week',
      'Push 1 more recurring plan → +3%',
      'Keep review streak alive',
    ],
    recentEvents: [
      { time: 'Mon 8:56 AM', text: 'Checked in early at Georgetown', type: 'positive' },
      { time: 'Tue 4:11 PM', text: '5-star review from repeat client', type: 'positive' },
      { time: 'Wed 12:30 PM', text: 'Recurring biweekly clean sold', type: 'positive' },
      { time: 'Thu 8:52 AM', text: 'Checked in early at Bethesda', type: 'positive' },
    ],
  },
  {
    id: 3,
    name: 'Team Orbit',
    members: ['Jasmine', 'Theo'],
    currentScore: 84,
    nextWeekPayout: 42,
    basePayout: 50,
    weeklyDelta: -16,
    status: 'At risk',
    rank: 4,
    jobsThisWeek: 15,
    onTimeRate: 76,
    fiveStarRate: 54,
    issues: 4,
    lateCheckins: 3,
    missedCheckins: 1,
    badReviews: 1,
    photoMisses: 2,
    recurringWins: 0,
    perfectStreak: 0,
    deductions: [
      { label: '3 late check-ins', value: -10, icon: Clock3 },
      { label: '1 missed check-in', value: -15, icon: ShieldAlert },
      { label: '1 bad review', value: -10, icon: Star },
      { label: '2 photo misses', value: -10, icon: Camera },
      { label: '1 major issue', value: -10, icon: Wrench },
    ],
    boosts: [],
    recovery: [
      'Zero late check-ins for next 5 jobs → +5%',
      'Complete QA photos on all jobs for 1 week → +3%',
      'Ops coaching completed → restore scheduling priority',
    ],
    recentEvents: [
      { time: 'Mon 9:17 AM', text: 'Missed check-in escalation triggered', type: 'negative' },
      { time: 'Tue 11:03 AM', text: 'Photo compliance missed', type: 'negative' },
      { time: 'Wed 3:18 PM', text: 'Bad review: late arrival + missed detail', type: 'negative' },
      { time: 'Thu 9:21 AM', text: 'Late check-in at Arlington job', type: 'negative' },
    ],
  },
  {
    id: 4,
    name: 'Team Apex',
    members: ['Maya', 'Dev'],
    currentScore: 97,
    nextWeekPayout: 48.5,
    basePayout: 50,
    weeklyDelta: -3,
    status: 'Stable',
    rank: 2,
    jobsThisWeek: 20,
    onTimeRate: 94,
    fiveStarRate: 80,
    issues: 1,
    lateCheckins: 1,
    missedCheckins: 0,
    badReviews: 0,
    photoMisses: 0,
    recurringWins: 1,
    perfectStreak: 1,
    deductions: [
      { label: '1 late check-in', value: -2, icon: Clock3 },
      { label: '1 minor issue', value: -5, icon: AlertTriangle },
    ],
    boosts: [
      { label: '1 recurring conversion', value: 3, icon: ArrowUpRight },
      { label: '5-job on-time streak', value: 5, icon: Trophy },
    ],
    recovery: [
      'Keep next 4 jobs on time → +2%',
      'Collect 1 five-star review → +2%',
      'Maintain issue-free week',
    ],
    recentEvents: [
      { time: 'Mon 9:04 AM', text: 'Late check-in by 4 minutes', type: 'negative' },
      { time: 'Tue 5:10 PM', text: 'Recurring upgrade sold', type: 'positive' },
      { time: 'Wed 8:55 AM', text: 'Early check-in at Capitol Hill', type: 'positive' },
      { time: 'Thu 6:20 PM', text: 'Minor issue resolved same day', type: 'neutral' },
    ],
  },
];

const jobsByTeam: Record<number, Job[]> = {
  1: [
    {
      id: 'j1',
      customer: 'Priya S.',
      area: 'Dupont Circle',
      time: 'Today • 9:00 AM',
      service: 'Standard clean • 1 bed / 1 bath',
      status: 'Completed with deductions',
      instantImpact: -15,
      weeklyImpact: -7,
      baseTeamPay: 96,
      finalTeamPay: 81,
      checkInStatus: '9:12 AM check-in • 12 min late',
      reviewStatus: 'No review yet',
      protocolStatus: '1 required photo missing',
      items: [
        { label: 'Late check-in', amount: -10, weekly: -5, tone: 'negative' },
        { label: 'Missing QA photo', amount: -5, weekly: -2, tone: 'negative' },
      ],
    },
    {
      id: 'j2',
      customer: 'Daniel M.',
      area: 'Adams Morgan',
      time: 'Yesterday • 2:00 PM',
      service: 'Deep clean • 2 bed / 1 bath',
      status: 'Strong finish',
      instantImpact: 10,
      weeklyImpact: 5,
      baseTeamPay: 140,
      finalTeamPay: 150,
      checkInStatus: '1:56 PM check-in • on time',
      reviewStatus: '5-star review received',
      protocolStatus: 'All photos complete',
      items: [
        { label: '5-star review', amount: 5, weekly: 2, tone: 'positive' },
        { label: 'Recurring conversion', amount: 5, weekly: 3, tone: 'positive' },
      ],
    },
  ],
  2: [
    {
      id: 'j3',
      customer: 'Lena P.',
      area: 'Georgetown',
      time: 'Today • 8:30 AM',
      service: 'Standard clean • 2 bed / 2 bath',
      status: 'Perfect job',
      instantImpact: 15,
      weeklyImpact: 6,
      baseTeamPay: 120,
      finalTeamPay: 135,
      checkInStatus: '8:23 AM check-in • early',
      reviewStatus: '5-star review received',
      protocolStatus: 'All photos complete',
      items: [
        { label: '5-star review', amount: 5, weekly: 2, tone: 'positive' },
        { label: 'Recurring conversion', amount: 10, weekly: 3, tone: 'positive' },
        { label: 'Perfect protocol completion', amount: 0, weekly: 1, tone: 'positive' },
      ],
    },
  ],
  3: [
    {
      id: 'j4',
      customer: 'Melissa T.',
      area: 'Arlington',
      time: 'Today • 9:00 AM',
      service: 'Move-out clean • 2 bed / 2 bath',
      status: 'At-risk job',
      instantImpact: -35,
      weeklyImpact: -15,
      baseTeamPay: 180,
      finalTeamPay: 145,
      checkInStatus: '9:21 AM check-in • 21 min late',
      reviewStatus: 'Complaint opened',
      protocolStatus: '2 required photos missing',
      items: [
        { label: 'Late check-in', amount: -15, weekly: -10, tone: 'negative' },
        { label: 'Complaint / issue opened', amount: -15, weekly: -5, tone: 'negative' },
        { label: 'Missing QA photo', amount: -5, weekly: 0, tone: 'negative' },
      ],
    },
  ],
  4: [
    {
      id: 'j5',
      customer: 'Evan R.',
      area: 'Capitol Hill',
      time: 'Today • 10:00 AM',
      service: 'Standard clean • 3 bed / 2 bath',
      status: 'Mostly clean execution',
      instantImpact: -2,
      weeklyImpact: -2,
      baseTeamPay: 135,
      finalTeamPay: 133,
      checkInStatus: '10:04 AM check-in • 4 min late',
      reviewStatus: 'No review yet',
      protocolStatus: 'All photos complete',
      items: [
        { label: 'Minor late check-in', amount: -2, weekly: -2, tone: 'negative' },
      ],
    },
  ],
};

// ─── Types ─────────────────────────────────────────────────────────────────────

type TeamStatus = 'Top performer' | 'Stable' | 'Needs attention' | 'At risk';

interface JobItem {
  label: string;
  amount: number;
  weekly: number;
  tone: 'positive' | 'negative';
}

interface Job {
  id: string;
  customer: string;
  area: string;
  time: string;
  service: string;
  status: string;
  instantImpact: number;
  weeklyImpact: number;
  baseTeamPay: number;
  finalTeamPay: number;
  checkInStatus: string;
  reviewStatus: string;
  protocolStatus: string;
  items: JobItem[];
}

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

function TeamCard({
  team,
  selected,
  onSelect,
}: {
  team: (typeof teams)[number];
  selected: boolean;
  onSelect: () => void;
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
              .join('')}
          </div>
          <div>
            <div className="text-base font-semibold">{team.name}</div>
            <div className={cx('text-sm', selected ? 'text-slate-300' : 'text-slate-500')}>
              {team.members.join(' • ')}
            </div>
          </div>
        </div>
        <Badge
          className={cx(
            'rounded-full border px-3 py-1 shrink-0',
            selected
              ? 'border-white/15 bg-white/10 text-white'
              : statusStyles[team.status as TeamStatus]
          )}
        >
          {team.status}
        </Badge>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div>
          <div className={cx('text-xs', selected ? 'text-slate-400' : 'text-slate-500')}>Score</div>
          <div className="mt-1 text-2xl font-semibold">{team.currentScore}%</div>
        </div>
        <div>
          <div className={cx('text-xs', selected ? 'text-slate-400' : 'text-slate-500')}>
            Next week pay
          </div>
          <div className="mt-1 text-2xl font-semibold">{team.nextWeekPayout}%</div>
        </div>
        <div>
          <div className={cx('text-xs', selected ? 'text-slate-400' : 'text-slate-500')}>
            Weekly delta
          </div>
          <div
            className={cx(
              'mt-1 text-2xl font-semibold',
              team.weeklyDelta >= 0
                ? 'text-emerald-400'
                : selected
                ? 'text-rose-300'
                : 'text-rose-600'
            )}
          >
            {team.weeklyDelta > 0 ? '+' : ''}
            {team.weeklyDelta}%
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className={selected ? 'text-slate-400' : 'text-slate-500'}>Performance health</span>
          <span className={selected ? 'text-slate-300' : 'text-slate-600'}>
            {team.onTimeRate}% on-time
          </span>
        </div>
        <div
          className={cx(
            'h-2 rounded-full overflow-hidden',
            selected ? 'bg-white/10' : 'bg-slate-100'
          )}
        >
          <div
            className={cx('h-full rounded-full', selected ? 'bg-white' : 'bg-slate-900')}
            style={{ width: `${Math.min(team.currentScore, 100)}%` }}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className={cx('text-sm', selected ? 'text-slate-300' : 'text-slate-500')}>
          {Number(payoutDiff) >= 0 ? '+' : ''}
          {payoutDiff}% vs base payout
        </div>
        <ChevronRight
          className={cx('h-4 w-4', selected ? 'text-slate-300' : 'text-slate-400')}
        />
      </div>
    </motion.button>
  );
}

function BreakdownRow({
  label,
  value,
  icon: Icon,
  positive = false,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={cx('rounded-xl p-2', positive ? 'bg-emerald-50' : 'bg-rose-50')}>
          <Icon
            className={cx('h-4 w-4', positive ? 'text-emerald-700' : 'text-rose-600')}
          />
        </div>
        <span className="text-sm font-medium text-slate-800">{label}</span>
      </div>
      <span className={cx('text-sm font-semibold', positive ? 'text-emerald-700' : 'text-rose-700')}>
        {positive ? '+' : ''}
        {value}%
      </span>
    </div>
  );
}

// ─── Simple tab primitives (no Radix, no context issues) ─────────────────────

const TabsContext = React.createContext<{
  active: string;
  setActive: (v: string) => void;
}>({ active: '', setActive: () => {} });

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
  tabs: { value: string; label: string }[];
}) {
  const { active, setActive } = React.useContext(TabsContext);
  return (
    <div className="grid w-full rounded-2xl bg-white p-1 shadow-sm" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => setActive(tab.value)}
          className={cx(
            'rounded-xl px-3 py-2 text-sm font-medium transition-all',
            active === tab.value
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
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
  const { active } = React.useContext(TabsContext);
  if (active !== value) return null;
  return <div className={className}>{children}</div>;
}

// ─── Main page ─────────────────────────────────────────────────────────────────

function TeamPayContent() {
  const [selectedId, setSelectedId] = useState(teams[0].id);
  const [selectedJob, setSelectedJob] = useState('j1');

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedId) ?? teams[0],
    [selectedId]
  );

  const teamJobs = jobsByTeam[selectedTeam.id] ?? [];
  const activeJob = teamJobs.find((j) => j.id === selectedJob) ?? teamJobs[0] ?? null;

  const summary = useMemo(() => {
    const avgScore = Math.round(
      teams.reduce((a, b) => a + b.currentScore, 0) / teams.length
    );
    const totalIssues = teams.reduce((a, b) => a + b.issues, 0);
    const riskTeams = teams.filter(
      (t) => t.status === 'At risk' || t.status === 'Needs attention'
    ).length;
    const avgPayout = (
      teams.reduce((a, b) => a + b.nextWeekPayout, 0) / teams.length
    ).toFixed(1);
    return { avgScore, totalIssues, riskTeams, avgPayout };
  }, []);

  React.useEffect(() => {
    const firstJob = (jobsByTeam[selectedTeam.id] ?? [])[0];
    if (firstJob) setSelectedJob(firstJob.id);
  }, [selectedTeam.id]);

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
                  Live this week
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {teams
                .slice()
                .sort((a, b) => b.currentScore - a.currentScore)
                .map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    selected={team.id === selectedId}
                    onSelect={() => setSelectedId(team.id)}
                  />
                ))}
            </CardContent>
          </Card>

          {/* Right: selected team detail */}
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
                          .join('')}
                      </div>
                      <div>
                        <h2 className="text-2xl font-semibold tracking-tight">
                          {selectedTeam.name}
                        </h2>
                        <p className="mt-1 text-sm text-slate-300">
                          {selectedTeam.members.join(' • ')}
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
                      {selectedTeam.deductions.length > 0 ? (
                        selectedTeam.deductions.map((item, i) => (
                          <BreakdownRow
                            key={i}
                            label={item.label}
                            value={item.value}
                            icon={item.icon}
                          />
                        ))
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                          No deductions this week.
                        </div>
                      )}
                      {selectedTeam.boosts.map((item, i) => (
                        <BreakdownRow
                          key={`b-${i}`}
                          label={item.label}
                          value={item.value}
                          icon={item.icon}
                          positive
                        />
                      ))}
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
                      {
                        label: 'Missed check-ins',
                        value: selectedTeam.missedCheckins,
                        tone: 'rose',
                      },
                      { label: 'Bad reviews', value: selectedTeam.badReviews, tone: 'rose' },
                      { label: 'Photo misses', value: selectedTeam.photoMisses, tone: 'amber' },
                      {
                        label: 'Recurring wins',
                        value: selectedTeam.recurringWins,
                        tone: 'emerald',
                      },
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
                        onClick={() => setSelectedJob(job.id)}
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
                                  activeJob.instantImpact >= 0
                                    ? 'text-emerald-400'
                                    : 'text-rose-300'
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
                                  activeJob.weeklyImpact >= 0
                                    ? 'text-emerald-400'
                                    : 'text-rose-300'
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

                    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                      <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                        <CardHeader>
                          <CardTitle className="text-xl">What changed on this job</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {activeJob.items.map((item, i) => (
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
                          ))}
                        </CardContent>
                      </Card>

                      <div className="space-y-6">
                        <Card className="rounded-[32px] border-0 bg-white shadow-sm">
                          <CardHeader>
                            <CardTitle className="text-xl">Protocol status</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {[
                              { label: 'Check-in', value: activeJob.checkInStatus },
                              { label: 'Review outcome', value: activeJob.reviewStatus },
                              { label: 'Photos / QA', value: activeJob.protocolStatus },
                            ].map((row) => (
                              <div
                                key={row.label}
                                className="rounded-3xl border border-slate-200 p-4"
                              >
                                <div className="text-xs text-slate-500">{row.label}</div>
                                <div className="mt-1 text-sm font-semibold text-slate-900">
                                  {row.value}
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="rounded-[32px] border-0 bg-slate-900 text-white shadow-sm">
                          <CardHeader>
                            <CardTitle className="text-xl">Operator actions</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <Button className="w-full justify-start rounded-2xl bg-white text-slate-900 hover:bg-slate-100">
                              Review evidence
                            </Button>
                            <Button
                              variant="secondary"
                              className="w-full justify-start rounded-2xl bg-white/10 text-white hover:bg-white/15"
                            >
                              Override job impact
                            </Button>
                            <Button
                              variant="secondary"
                              className="w-full justify-start rounded-2xl bg-white/10 text-white hover:bg-white/15"
                            >
                              Coach team on this event
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </div>
                ) : null}
              </SimpleTabsContent>
            </SimpleTabsRoot>
          </div>
        </div>
      </div>
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
