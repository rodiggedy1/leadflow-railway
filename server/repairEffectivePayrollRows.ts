import mysql from "mysql2/promise";
import { PAYROLL_REPAIR_TARGETS, buildPayrollRepairPlan, type PayrollRepairSourceRow } from "./payrollRepairPlan";

const APPLY_FLAG = "--apply";

function assertArguments(): boolean {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== APPLY_FLAG)) {
    throw new Error(`Unsupported argument. Use no argument for dry run or ${APPLY_FLAG} to apply.`);
  }
  return args.includes(APPLY_FLAG);
}

async function main() {
  const apply = assertArguments();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = mysql.createPool(process.env.DATABASE_URL);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const ids = PAYROLL_REPAIR_TARGETS.map(target => target.id);
    const [rows] = await conn.query<PayrollRepairSourceRow[]>(
      `SELECT id, jobDate, jobRevenue, payPercent, manualAdjustment, basePay, finalPay
       FROM cleaner_jobs
       WHERE id IN (${ids.map(() => "?").join(",")})
       FOR UPDATE`,
      ids,
    );

    const plan = buildPayrollRepairPlan(rows);
    console.table(plan);

    if (!apply) {
      await conn.rollback();
      console.log("Dry run passed. Transaction rolled back; no rows changed.");
      return;
    }

    for (const item of plan) {
      if (item.action === "already-correct") continue;
      const [result] = await conn.execute(
        `UPDATE cleaner_jobs SET basePay = ?, finalPay = ? WHERE id = ?`,
        [item.calculatedBasePay, item.calculatedFinalPay, item.id],
      );
      if (result.affectedRows !== 1) {
        throw new Error(`Expected one updated row for cleaner_jobs.id ${item.id}`);
      }
    }

    await conn.commit();
    console.log("Seven-row effective payroll repair committed.");
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
