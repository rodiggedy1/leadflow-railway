import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { buildPayrollWorkbook, createSafeWorksheetName } from "../client/src/lib/payrollWorkbook";

const newPeriodSummary = {
  teamName: "Team A",
  jobs: 2,
  payrollMode: "2026-08-16" as const,
  jobRevenue: 400,
  operationalCost: 52,
  netJobAmount: 348,
  basePay: 174,
  ratingAdj: 0,
  photoAdj: 0,
  streakBonus: 0,
  googleBonus: 0,
  recleanPenalty: 0,
  complaintCharge: 0,
  manualAdj: 10,
  lateCount: 0,
  missedCheckins: 0,
  payoutPct: 50,
  finalPay: 184,
};

const newPeriodDetail = {
  teamName: "Team A",
  weekStart: "2026-08-23",
  weekEnd: "2026-08-29",
  totalFinalPay: 184,
  jobs: [
    {
      jobDate: "2026-08-24",
      time: "Aug 24, 9:00 AM",
      customer: "Customer One",
      address: "123 Main St",
      service: "Standard Cleaning / 2 bed / 1 bath",
      status: "Completed",
      payrollMode: "2026-08-16" as const,
      jobRevenue: 200,
      operationalCost: 26,
      netJobAmount: 174,
      payoutPct: 50,
      basePay: 87,
      photoAdj: 0,
      ratingAdj: 0,
      streakBonus: 0,
      manualAdj: 5,
      reclean: 0,
      complaint: 0,
      finalPay: 92,
    },
    {
      jobDate: "2026-08-25",
      time: "Aug 25, 1:00 PM",
      customer: "Customer Two",
      address: "456 Oak Ave",
      service: "Deep Cleaning / 3 bed / 2 bath",
      status: "5-star",
      payrollMode: "2026-08-16" as const,
      jobRevenue: 200,
      operationalCost: 26,
      netJobAmount: 174,
      payoutPct: 50,
      basePay: 87,
      photoAdj: 0,
      ratingAdj: 0,
      streakBonus: 0,
      manualAdj: 5,
      reclean: 0,
      complaint: 0,
      finalPay: 92,
    },
  ],
};

describe("Payroll workbook export", () => {
  it("creates safe, unique Excel worksheet names", () => {
    const used = new Set<string>(["summary"]);
    expect(createSafeWorksheetName("Martha / DC [North]", used)).toBe("Martha DC North");
    expect(createSafeWorksheetName("Martha / DC [North]", used)).toBe("Martha DC North (2)");
    expect(createSafeWorksheetName("Summary", used)).toBe("Summary (2)");
    expect(createSafeWorksheetName("A very long team name that exceeds thirty one characters", used).length).toBeLessThanOrEqual(31);
  });

  it("creates one Summary sheet and one detailed worksheet per team using existing payroll values", async () => {
    const workbook = buildPayrollWorkbook({
      rows: [newPeriodSummary],
      teamDetails: [newPeriodDetail],
      weekStart: "2026-08-23",
      weekEnd: "2026-08-29",
    });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Team A"]);
    expect(workbook.getWorksheet("Summary")?.getCell("C3").value).toBe("Payroll Summary");
    expect(workbook.getWorksheet("Summary")?.getCell("C9").value).toBe("Team A");
    expect(workbook.getWorksheet("Summary")?.getCell("K9").value).toBe(184);
    expect(workbook.getWorksheet("Summary")?.getCell("K10").value).toEqual({ formula: "SUM(K9:K9)" });
    expect(workbook.getWorksheet("Team A")?.getCell("E9").value).toBe("Customer One");
    expect(workbook.getWorksheet("Team A")?.getCell("O9").value).toBe(92);
    expect(workbook.getWorksheet("Team A")?.getCell("O11").value).toEqual({ formula: "SUM(O9:O10)" });

    const buffer = await workbook.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    expect(reloaded.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Team A"]);
    expect(reloaded.getWorksheet("Team A")?.getCell("O10").value).toBe(92);
  });

  it("rejects a workbook when any summary team is missing its detail payload", () => {
    expect(() => buildPayrollWorkbook({
      rows: [newPeriodSummary],
      teamDetails: [],
      weekStart: "2026-08-23",
      weekEnd: "2026-08-29",
    })).toThrow("Payroll detail was not loaded for Team A.");
  });
});

describe("Payroll workbook page contract", () => {
  it("uses the current selected week and existing Team Pay procedures without adding payroll calculation logic", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("../client/src/pages/PayrollSummary.tsx", import.meta.url), "utf8")
    );
    expect(source).toContain("rows.map((row) => loadWorkbookTeamDetail({ teamName: row.teamName, weekStart }))");
    expect(source).toContain("downloadPayrollWorkbook({ rows, teamDetails, weekStart, weekEnd })");
    expect(source).toContain("Download Workbook");
  });
});
