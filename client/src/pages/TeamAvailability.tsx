import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { CalendarDays, CheckCircle2, CircleOff, Clock3, Loader2, MapPin, RefreshCw, Users } from "lucide-react";

const WEEK_DAYS: Array<[keyof NonNullable<NonNullable<ReturnType<typeof useOverview>["data"]>["teams"][number]["weeklySchedule"]>, string]> = [["sun", "Sun"], ["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"]];

function useOverview() {
  return trpc.teamAvailability.getOverview.useQuery(undefined, { staleTime: 60_000, throwOnError: false });
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function TeamAvailabilityContent() {
  const overview = useOverview();
  const teams = overview.data?.teams ?? [];
  const availableCount = teams.filter(team => team.nextDayAvailability?.isAvailable).length;
  const awaitingCount = teams.filter(team => !team.nextDayAvailability).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader activeTab="team-availability" />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Staff</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Team availability</h1>
            <p className="mt-2 text-sm text-slate-500">Weekly schedules and next-day confirmations submitted by cleaning teams.</p>
          </div>
          <Button variant="outline" className="gap-2 self-start bg-white" onClick={() => overview.refetch()} disabled={overview.isFetching}>
            <RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {overview.isLoading ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : overview.isError ? (
          <Card className="border-red-100"><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><CircleOff className="h-7 w-7 text-red-500" /><p className="font-medium text-slate-900">Team availability could not be loaded.</p><Button variant="outline" onClick={() => overview.refetch()}>Try again</Button></CardContent></Card>
        ) : (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <Card className="border-0 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-blue-50 p-2.5"><CalendarDays className="h-5 w-5 text-blue-600" /></div><div><p className="text-xs font-medium text-slate-500">Viewing availability for</p><p className="font-semibold text-slate-900">{formatDate(overview.data!.availabilityDate)}</p></div></CardContent></Card>
              <Card className="border-0 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-emerald-50 p-2.5"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div><div><p className="text-xs font-medium text-slate-500">Available teams</p><p className="font-semibold text-slate-900">{availableCount} of {teams.length}</p></div></CardContent></Card>
              <Card className="border-0 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-amber-50 p-2.5"><Clock3 className="h-5 w-5 text-amber-600" /></div><div><p className="text-xs font-medium text-slate-500">Awaiting confirmation</p><p className="font-semibold text-slate-900">{awaitingCount} teams</p></div></CardContent></Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {teams.map(team => <Card key={team.teamId} className="border-0 shadow-sm"><CardContent className="p-5">
                <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">{team.teamName}</h2><p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><Users className="h-3.5 w-3.5" /> {team.cleanerName ?? "No linked cleaner portal"}</p></div>{team.nextDayAvailability ? <Badge className={team.nextDayAvailability.isAvailable ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}>{team.nextDayAvailability.isAvailable ? "Available" : "Unavailable"}</Badge> : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Awaiting</Badge>}</div>
                {team.homeAddress ? <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{team.homeAddress}</p> : null}
                <div className="mt-5 border-t border-slate-100 pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Weekly schedule</p>{team.weeklySchedule ? <div className="flex flex-wrap gap-1.5">{WEEK_DAYS.map(([day, label]) => <span key={day} className={`rounded-md px-2 py-1 text-xs font-medium ${team.weeklySchedule![day] ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}>{label}</span>)}</div> : <p className="text-sm text-slate-400">Not set</p>}{team.weeklySchedule?.note ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{team.weeklySchedule.note}</p> : null}</div>
                <div className="mt-4 border-t border-slate-100 pt-4"><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Next-day confirmation</p>{team.nextDayAvailability ? <><p className="text-sm text-slate-700">{team.nextDayAvailability.isAvailable ? "Available for assignments" : "Unavailable for assignments"}</p>{team.nextDayAvailability.note ? <p className="mt-1 text-xs text-slate-500">{team.nextDayAvailability.note}</p> : null}<p className="mt-2 text-xs text-slate-400">Submitted {formatTimestamp(team.nextDayAvailability.submittedAt)}</p></> : <p className="text-sm text-slate-400">No confirmation submitted for this day.</p>}</div>
              </CardContent></Card>)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function TeamAvailability() {
  return <AdminPageGuard pageId="team-availability"><TeamAvailabilityContent /></AdminPageGuard>;
}
