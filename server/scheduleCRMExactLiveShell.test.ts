import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const legacyJobSymbol = ["cleaner", "Jobs"].join("");
const legacyJobTable = ["cleaner", "jobs"].join("_");

const ownedClientFiles = [
  "client/src/App.tsx",
  "client/src/pages/LeadflowScheduleCRMExactLive.tsx",
  "client/src/components/LeadflowScheduleMap.tsx",
  "client/src/components/LeadflowScheduleIssueDialog.tsx",
  "client/src/components/LeadflowScheduleCallLogPanel.tsx",
];

const ownedServerFiles = [
  "server/leadflowScheduleRouter.ts",
  "server/leadflowScheduleAssignmentDefaults.ts",
  "server/leadflowScheduleCallsRouter.ts",
];

describe("LeadFlow-owned Schedule workspace", () => {
  it("routes the approved Schedule composition through the isolated owned API", () => {
    const app = read("client/src/App.tsx");
    const shell = read("client/src/pages/LeadflowScheduleCRMExactLive.tsx");

    expect(app).toContain('const LeadflowScheduleCRMExactLive = lazy(() => import("./pages/LeadflowScheduleCRMExactLive"));');
    expect(app).toContain('<AdminPageGuard pageId="field-management"><ReviewWorkspaceFrame navActivePath="/review/schedule-crm"><LeadflowScheduleCRMExactLive /></ReviewWorkspaceFrame></AdminPageGuard>');
    expect(app).toContain('<Route path={"/admin/schedule"} component={AdminScheduleCRMExactRoute} />');
    expect(shell).toContain('trpc.leadflowSchedule.getSchedule.useQuery({ date }');
    expect(shell).toContain('trpc.leadflowSchedule.getJobLocks.useQuery({ date })');
    expect(shell).toContain('trpc.leadflowSchedule.analyzeSchedule.useQuery({ date }');
    expect(shell).toContain('trpc.leadflowScheduleCalls.getDayIssues.useQuery({ jobDate: date }');
    expect(shell).toContain('trpc.leadflowSchedule.suggestSlots.useQuery({ address: suggestAddress, date }');
    expect(shell).toContain('trpc.leadflowSchedule.optimizeDay.useMutation');
    expect(shell).toContain('trpc.leadflowSchedule.manualAssign.useMutation');
    expect(shell).toContain('job.assignment?.source === "booking_default"');
    expect(shell).toContain('<LeadflowScheduleCallLogPanel');
    expect(shell).toContain('<LeadflowScheduleIssueDialog');
    expect(shell).toContain('<LeadflowScheduleMap');
  });

  it("keeps read paths explicit and action paths human-triggered", () => {
    const scheduleRouter = read("server/leadflowScheduleRouter.ts");
    const callsRouter = read("server/leadflowScheduleCallsRouter.ts");

    for (const marker of [
      "getSchedule: agentProcedure",
      "getJobLocks: agentProcedure",
      "analyzeSchedule: agentProcedure",
      "suggestSlots: agentProcedure",
      "optimizeDay: agentProcedure",
      "resetOptimization: agentProcedure",
      "manualAssign: agentProcedure",
      "lockJob: agentProcedure",
      "unassignJob: agentProcedure",
      "leadflowJobId",
      "notInArray(leadflowJobs.bookingStatus",
    ]) expect(scheduleRouter).toContain(marker);

    for (const marker of [
      "raiseIssue: agentProcedure",
      "fireCall: agentProcedure",
      "getDayIssues: agentProcedure",
      "getCallLog: agentProcedure",
      "leadflowJobId",
      "postOutboundVapiCall",
    ]) expect(callsRouter).toContain(marker);

    expect(scheduleRouter).not.toContain("invokeLLM");
    expect(scheduleRouter).not.toContain("confirmationCalls");
    expect(scheduleRouter).toContain("bookingTeamDefault(job, teams)");
    expect(scheduleRouter).toContain('source: "booking_default" as const');
    expect(scheduleRouter).toContain('source: "schedule" as const');
    expect(scheduleRouter).not.toContain("db.insert(scheduleAssignments)");
  });

  it("applies embedded night styling only to the Schedule Route Map", () => {
    const mapView = read("client/src/components/Map.tsx");
    const routeMap = read("client/src/components/LeadflowScheduleMap.tsx");

    expect(mapView).toContain("mapOptions?: MapViewOptions");
    expect(mapView).toContain('const { mapId = "DEMO_MAP_ID", ...additionalMapOptions } = mapOptions ?? {};');
    expect(mapView).toContain("...(mapId ? { mapId } : {})");
    expect(routeMap).toContain("const SCHEDULE_ROUTE_NIGHT_STYLE");
    expect(routeMap).toContain("mapOptions={{ mapId: null, styles: SCHEDULE_ROUTE_NIGHT_STYLE }}");
    expect(routeMap).toContain('featureType: "road"');
    expect(routeMap).toContain('featureType: "poi"');
    expect(routeMap).toContain('featureType: "water"');
  });

  it("keeps every new Schedule source file outside the legacy job boundary", () => {
    for (const relativePath of [...ownedClientFiles, ...ownedServerFiles]) {
      const source = read(relativePath);
      expect(source).not.toContain(legacyJobSymbol);
      expect(source).not.toContain(legacyJobTable);
    }
  });
});
