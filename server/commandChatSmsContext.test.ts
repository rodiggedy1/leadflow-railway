import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("Command Chat SMS booking context", () => {
  it("uses the existing owned client booking and Schedule contracts", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const styles = read("client/src/pages/command-chat-exact-live.css");
    const jobsRouter = read("server/leadflowJobsRouter.ts");
    const scheduleRouter = read("server/leadflowScheduleRouter.ts");
    const teamLookupStart = jobsRouter.indexOf("teamIdentityByPhone: opsChatProcedure");
    const teamLookupEnd = jobsRouter.indexOf("customerConversationSession: opsChatProcedure", teamLookupStart);
    const teamLookup = jobsRouter.slice(teamLookupStart, teamLookupEnd);

    expect(page).toContain("trpc.leadflowJobs.customerProfile.useQuery");
    expect(page).toContain("trpc.leadflowJobs.teamIdentityByPhone.useQuery");
    expect(page).toContain("trpc.leadflowSchedule.getSchedule.useQuery");
    expect(page).toContain('className="ccc-live-sms-booking-context"');
    expect(page).toContain('className="ccc-live-sms-team-schedule"');
    expect(page).toContain("bookingDateLabel(clientProfile.upcoming.date, businessDate)");
    expect(page).toContain("team.launch27TeamId === teamIdentity.launch27TeamId");
    expect(page).toContain("job.assignment?.teamId === activeScheduleTeam.id");
    expect(page).toContain("function bookingDateLabel");
    expect(page).toContain('if (date === businessDate) return "Today";');
    expect(styles).toContain(".ccc-live-sms-booking-context");
    expect(styles).toContain(".ccc-live-sms-team-schedule");

    expect(teamLookupStart).toBeGreaterThanOrEqual(0);
    expect(teamLookupEnd).toBeGreaterThan(teamLookupStart);
    expect(teamLookup).toContain("cleanerProfiles.launch27TeamId");
    expect(teamLookup).not.toContain("cleaner" + "Jobs");
    expect(scheduleRouter).toContain("launch27TeamId: team.launch27TeamId");
  });

  it("adds only owned progress status and ETA to each existing team route stop", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const styles = read("client/src/pages/command-chat-exact-live.css");
    const scheduleRouter = read("server/leadflowScheduleRouter.ts");

    expect(scheduleRouter).toContain("cleanerPortalJobProgress");
    expect(scheduleRouter).toContain("leftJoin(cleanerPortalJobProgress");
    expect(scheduleRouter).toContain("jobStatus: jobStatusById.get(job.id) ?? null");
    expect(scheduleRouter).toContain("etaTimestamp: etaTimestampById.get(job.id) ?? null");
    expect(scheduleRouter).not.toContain("cleaner" + "Jobs");

    expect(page).toContain("function teamRouteStatusLabel");
    expect(page).toContain("function TeamRouteStatusIcon");
    expect(page).toContain("function teamRouteEtaLabel");
    expect(page).toContain('case "on_the_way": return "On the way";');
    expect(page).toContain('case "completed": return "Completed";');
    expect(page).toContain('default: return "Scheduled";');
    expect(page).toContain("teamRouteStatusLabel(job.jobStatus)");
    expect(page).toContain("teamRouteEtaLabel(job.jobStatus, job.etaTimestamp)");
    expect(page).toContain("scheduleTimeLabel(job.serviceDateTime)");
    expect(page).toContain("refetchInterval: 60_000");
    expect(styles).toContain(".ccc-live-sms-job-status");
    expect(styles).toContain(".ccc-live-sms-job-status>svg");
    expect(styles).toContain(".ccc-live-sms-job-status>small");
  });
});
