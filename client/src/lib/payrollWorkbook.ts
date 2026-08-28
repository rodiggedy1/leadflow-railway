import ExcelJS from "exceljs/dist/exceljs.min.js";

type Cell = any;
type Worksheet = any;
type PayrollWorkbook = any;

export type PayrollSummaryRow = {
  teamName: string;
  jobs: number;
  payrollMode?: "legacy" | "2026-08-16";
  jobRevenue?: number;
  operationalCost?: number;
  netJobAmount?: number;
  basePay: number;
  ratingAdj: number;
  photoAdj: number;
  streakBonus: number;
  googleBonus: number;
  recleanPenalty: number;
  complaintCharge: number;
  manualAdj: number;
  lateCount: number;
  missedCheckins: number;
  payoutPct: number;
  finalPay: number;
};

export type PayrollTeamJob = {
  jobDate: string;
  time: string;
  customer: string;
  address: string;
  service: string;
  status: string;
  payrollMode?: "legacy" | "2026-08-16";
  jobRevenue?: number;
  operationalCost?: number;
  netJobAmount?: number;
  payoutPct?: number;
  basePay: number;
  photoAdj: number;
  ratingAdj: number;
  streakBonus: number;
  manualAdj: number;
  reclean: number;
  complaint: number;
  finalPay: number;
};

export type PayrollTeamDetail = {
  teamName: string;
  weekStart: string;
  weekEnd: string;
  jobs: PayrollTeamJob[];
  totalFinalPay: number;
};

export type PayrollWorkbookInput = {
  rows: PayrollSummaryRow[];
  teamDetails: PayrollTeamDetail[];
  weekStart: string;
  weekEnd: string;
};

const TITLE_FILL = "135B44";
const SECTION_FILL = "CFE9E0";
const INPUT_BLUE = "0000FF";
const FORMULA_BLACK = "000000";
const HEADER_ROW = 8;
const FIRST_DATA_ROW = 9;
const CURRENCY_FORMAT = '$#,##0.00;($#,##0.00);-';
const INTEGER_FORMAT = '#,##0;(#,##0);-';
const PERCENT_FORMAT = '0.0%';

function columnLetter(columnNumber: number): string {
  let result = "";
  let value = columnNumber;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function sourceNote(period: string, detail: string): string {
  return `Source: LeadFlow Railway database, ${period}, ${detail}.`;
}

function addSourceNote(cell: Cell, note: string) {
  cell.note = note;
  cell.font = { ...cell.font, color: { argb: INPUT_BLUE } };
}

function styleWorkbookSheet(
  sheet: Worksheet,
  title: string,
  subtitle: string,
  unit: string,
  lastColumn: number,
) {
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 20;
  sheet.mergeCells(3, 3, 3, lastColumn);
  const titleCell = sheet.getCell(3, 3);
  titleCell.value = title;
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  titleCell.font = { color: { argb: "FFFFFF" }, size: 16, bold: true };
  titleCell.alignment = { vertical: "middle" };
  sheet.getRow(3).height = 24;
  sheet.getCell(5, 3).value = subtitle;
  sheet.getCell(5, 3).font = { bold: true, size: 11 };
  sheet.getCell(6, 3).value = unit;
  sheet.getCell(6, 3).font = { italic: true, color: { argb: "666666" } };
  sheet.views = [{ style: "pageBreakPreview", showGridLines: false }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `B2:${columnLetter(lastColumn)}${Math.max(sheet.rowCount, HEADER_ROW)}`,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  sheet.headerFooter.oddFooter = `&L${sheet.name}&RPage &P of &N`;
}

function styleHeaderRow(sheet: Worksheet, lastColumn: number) {
  const row = sheet.getRow(HEADER_ROW);
  for (let column = 3; column <= lastColumn; column += 1) {
    const cell = row.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
    cell.font = { bold: true, color: { argb: FORMULA_BLACK } };
    cell.alignment = { vertical: "middle", wrapText: true };
  }
  row.height = 30;
}

function autoFitColumns(sheet: Worksheet, firstColumn: number, lastColumn: number) {
  for (let columnNumber = firstColumn; columnNumber <= lastColumn; columnNumber += 1) {
    const column = sheet.getColumn(columnNumber);
    let width = 10;
    column.eachCell({ includeEmpty: false }, (cell: Cell) => {
      const value = cell.value;
      const text = typeof value === "object" && value && "formula" in value
        ? String((value as { formula: string }).formula)
        : String(value ?? "");
      width = Math.max(width, Math.min(text.length + 2, 42));
    });
    column.width = width;
  }
}

function setCurrency(cell: Cell) {
  cell.numFmt = CURRENCY_FORMAT;
  cell.alignment = { horizontal: "right" };
}

function setInteger(cell: Cell) {
  cell.numFmt = INTEGER_FORMAT;
  cell.alignment = { horizontal: "right" };
}

function setPercentage(cell: Cell) {
  cell.numFmt = PERCENT_FORMAT;
  cell.alignment = { horizontal: "right" };
}

export function createSafeWorksheetName(rawName: string, usedNames: Set<string>): string {
  const cleaned = rawName
    .replace(/[\\/?*\[\]:]/g, " ")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+/g, " ")
    .trim() || "Team";
  let index = 1;
  let candidate = cleaned.slice(0, 31);
  while (usedNames.has(candidate.toLowerCase())) {
    index += 1;
    const suffix = ` (${index})`;
    candidate = `${cleaned.slice(0, 31 - suffix.length)}${suffix}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function buildSummarySheet(workbook: PayrollWorkbook, input: PayrollWorkbookInput) {
  const { rows, weekStart, weekEnd } = input;
  const sheet = workbook.addWorksheet("Summary");
  const isNewPayrollPeriod = rows[0]?.payrollMode === "2026-08-16";
  const headers = isNewPayrollPeriod
    ? ["Team", "Jobs", "Job Amount", "Operations Cost (13%)", "Net Job Amount", "Payout %", "Base Pay", "Manual Adj", "Final Pay"]
    : ["Team", "Jobs", "Base Pay", "Rating Adj", "Photo Adj", "Streak Bonus", "Google Review Bonus", "Reclean Penalty", "Complaint Charge", "Manual Adj", "Late Check-ins", "Pay Rate %", "Final Pay"];
  const lastColumn = headers.length + 2;
  styleWorkbookSheet(sheet, "Payroll Summary", `${weekStart} to ${weekEnd}`, "($ in dollars; source values shown in blue)", lastColumn);
  headers.forEach((header, index) => { sheet.getCell(HEADER_ROW, index + 3).value = header; });
  styleHeaderRow(sheet, lastColumn);

  const period = `${weekStart} to ${weekEnd}`;
  rows.forEach((row, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const values = isNewPayrollPeriod
      ? [row.teamName, row.jobs, row.jobRevenue ?? 0, row.operationalCost ?? 0, row.netJobAmount ?? 0, row.payoutPct / 100, row.basePay, row.manualAdj, row.finalPay]
      : [row.teamName, row.jobs, row.basePay, row.ratingAdj, row.photoAdj, row.streakBonus, row.googleBonus, row.recleanPenalty, row.complaintCharge, row.manualAdj, row.lateCount, row.payoutPct / 100, row.finalPay];
    values.forEach((value, valueIndex) => {
      const cell = sheet.getCell(rowNumber, valueIndex + 3);
      cell.value = value;
      addSourceNote(cell, sourceNote(period, `Payroll Summary procedure; team ${row.teamName}`));
    });
    setInteger(sheet.getCell(rowNumber, 4));
    if (isNewPayrollPeriod) {
      [5, 6, 7, 9, 10, 11].forEach((column) => setCurrency(sheet.getCell(rowNumber, column)));
      setPercentage(sheet.getCell(rowNumber, 8));
    } else {
      for (let column = 5; column <= 12; column += 1) setCurrency(sheet.getCell(rowNumber, column));
      setInteger(sheet.getCell(rowNumber, 13));
      setPercentage(sheet.getCell(rowNumber, 14));
      setCurrency(sheet.getCell(rowNumber, 15));
    }
  });

  const totalRowNumber = FIRST_DATA_ROW + rows.length;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell(3).value = "TOTAL";
  totalRow.font = { bold: true, color: { argb: FORMULA_BLACK } };
  totalRow.getCell(3).border = { top: { style: "thin", color: { argb: "000000" } }, bottom: { style: "double", color: { argb: "000000" } } };
  for (let column = 4; column <= lastColumn; column += 1) {
    if ((isNewPayrollPeriod && column === 8) || (!isNewPayrollPeriod && column === 14)) continue;
    totalRow.getCell(column).value = { formula: `SUM(${columnLetter(column)}${FIRST_DATA_ROW}:${columnLetter(column)}${totalRowNumber - 1})` };
    totalRow.getCell(column).font = { bold: true, color: { argb: FORMULA_BLACK } };
    totalRow.getCell(column).border = { top: { style: "thin", color: { argb: "000000" } }, bottom: { style: "double", color: { argb: "000000" } } };
  }
  setInteger(totalRow.getCell(4));
  if (isNewPayrollPeriod) {
    [5, 6, 7, 9, 10, 11].forEach((column) => setCurrency(totalRow.getCell(column)));
  } else {
    for (let column = 5; column <= 12; column += 1) setCurrency(totalRow.getCell(column));
    setInteger(totalRow.getCell(13));
    setCurrency(totalRow.getCell(15));
  }
  autoFitColumns(sheet, 3, lastColumn);
  sheet.pageSetup.printArea = `B2:${columnLetter(lastColumn)}${totalRowNumber}`;
}

function buildTeamSheet(workbook: PayrollWorkbook, detail: PayrollTeamDetail, sheetName: string) {
  const isNewPayrollPeriod = detail.jobs[0]?.payrollMode === "2026-08-16";
  const headers = isNewPayrollPeriod
    ? ["Date", "Time", "Customer", "Address", "Service", "Status", "Job Amount", "Operations Cost (13%)", "Net Job Amount", "Payout %", "Base Pay", "Manual Adj", "Final Pay"]
    : ["Date", "Time", "Customer", "Address", "Service", "Status", "Base Pay", "Photo Adj", "Rating Adj", "Streak Bonus", "Manual Adj", "Reclean", "Complaint", "Final Pay"];
  const lastColumn = headers.length + 2;
  const sheet = workbook.addWorksheet(sheetName);
  styleWorkbookSheet(sheet, `${detail.teamName} Payroll Detail`, `${detail.weekStart} to ${detail.weekEnd}`, "($ in dollars; source values shown in blue)", lastColumn);
  headers.forEach((header, index) => { sheet.getCell(HEADER_ROW, index + 3).value = header; });
  styleHeaderRow(sheet, lastColumn);

  const period = `${detail.weekStart} to ${detail.weekEnd}`;
  detail.jobs.forEach((job, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const values = isNewPayrollPeriod
      ? [job.jobDate, job.time, job.customer, job.address, job.service, job.status, job.jobRevenue ?? 0, job.operationalCost ?? 0, job.netJobAmount ?? 0, (job.payoutPct ?? 0) / 100, job.basePay, job.manualAdj, job.finalPay]
      : [job.jobDate, job.time, job.customer, job.address, job.service, job.status, job.basePay, job.photoAdj, job.ratingAdj, job.streakBonus, job.manualAdj, job.reclean, job.complaint, job.finalPay];
    values.forEach((value, valueIndex) => {
      const cell = sheet.getCell(rowNumber, valueIndex + 3);
      cell.value = value;
      addSourceNote(cell, sourceNote(period, `Payroll Team Detail procedure; team ${detail.teamName}; job date ${job.jobDate}`));
    });
    if (isNewPayrollPeriod) {
      [9, 10, 11, 13, 14, 15].forEach((column) => setCurrency(sheet.getCell(rowNumber, column)));
      setPercentage(sheet.getCell(rowNumber, 12));
    } else {
      for (let column = 9; column <= 16; column += 1) setCurrency(sheet.getCell(rowNumber, column));
    }
  });

  const totalRowNumber = FIRST_DATA_ROW + detail.jobs.length;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell(3).value = "TOTAL";
  totalRow.font = { bold: true, color: { argb: FORMULA_BLACK } };
  for (let column = 3; column <= lastColumn; column += 1) {
    totalRow.getCell(column).border = { top: { style: "thin", color: { argb: "000000" } }, bottom: { style: "double", color: { argb: "000000" } } };
  }
  const firstMoneyColumn = isNewPayrollPeriod ? 9 : 9;
  for (let column = firstMoneyColumn; column <= lastColumn; column += 1) {
    if (isNewPayrollPeriod && column === 12) continue;
    totalRow.getCell(column).value = { formula: `SUM(${columnLetter(column)}${FIRST_DATA_ROW}:${columnLetter(column)}${totalRowNumber - 1})` };
    totalRow.getCell(column).font = { bold: true, color: { argb: FORMULA_BLACK } };
    setCurrency(totalRow.getCell(column));
  }
  autoFitColumns(sheet, 3, lastColumn);
  sheet.pageSetup.printArea = `B2:${columnLetter(lastColumn)}${totalRowNumber}`;
}

export function buildPayrollWorkbook(input: PayrollWorkbookInput): PayrollWorkbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Maids in Black LeadFlow";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  buildSummarySheet(workbook, input);

  const usedNames = new Set(["summary"]);
  const detailsByTeam = new Map(input.teamDetails.map((detail) => [detail.teamName, detail]));
  for (const row of input.rows) {
    const detail = detailsByTeam.get(row.teamName);
    if (!detail) throw new Error(`Payroll detail was not loaded for ${row.teamName}.`);
    const sheetName = createSafeWorksheetName(row.teamName, usedNames);
    buildTeamSheet(workbook, detail, sheetName);
  }
  return workbook;
}

export async function downloadPayrollWorkbook(input: PayrollWorkbookInput): Promise<string> {
  const workbook = buildPayrollWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `payroll-${input.weekStart}-to-${input.weekEnd}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 100);
  return filename;
}
