import { runEndOfDayLeadflowJobRecurrence } from "./leadflowJobsService";

export async function runLeadflowJobRecurrenceCron(): Promise<void> {
  const result = await runEndOfDayLeadflowJobRecurrence();
  console.log(`[LeadflowJobs] End-of-day recurrence — checked: ${result.checked}, created: ${result.created}, skipped: ${result.skipped}, errors: ${result.errors}`);
}
