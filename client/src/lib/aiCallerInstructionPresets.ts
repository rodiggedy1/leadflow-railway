type InstructionPreset = { label: string; text: string };

/** New caller presets guide the whole conversation; they are not spoken scripts or booking facts. */
const customerPresets: readonly InstructionPreset[] = [
  { label: "Team running late", text: "Let the customer know the team is running late. Use only the arrival estimate and reason for the delay that I provide. Check whether the updated timing works for them and answer their questions naturally. If an arrival estimate is not provided, say that you do not have one yet." },
  { label: "Running significantly late", text: "Explain the significant delay using only the timing and details I provide. Ask whether the customer can still accommodate the visit and listen to their concerns. Discuss alternatives only if I provide them; do not claim to have rescheduled anything." },
  { label: "Team at address / access needed", text: "Ask the customer how the team should access the property, including any relevant lockbox, gate, concierge, or entry instructions. Use only the team location I provide and do not assume they have arrived. Clarify the customer's answer and summarize the access details." },
  { label: "Parking instructions", text: "Ask the customer for parking instructions for the cleaning team. Clarify any parking restrictions, permits, or preferred location that they mention. Do not assume an arrival time or property address; use only details I provide or the customer confirms." },
  { label: "Put card on file", text: "Explain that the purpose of the call is to ask the customer to put a card on file. Direct them to Maids in Black or an existing secure card-entry option only if I provide its details. Answer their questions using the information supplied; do not ask them to read card details aloud or claim to have saved a card." },
  { label: "Payment failed", text: "Discuss the payment issue using only the details I provide. Ask the customer to contact Maids in Black or use an existing secure payment option if its details are supplied. Listen to their questions and concerns without assuming the reason for the failure or claiming a payment has been retried or processed." },
  { label: "Confirm address", text: "Ask the customer to confirm the complete service address, including city and any unit number. Clarify relevant parking, entry instructions, or special notes they mention. Summarize the confirmed details without inventing a booking or claiming to have updated it." },
  { label: "Scope clarification", text: "Clarify the cleaning scope using only the areas and questions I provide. Ask the customer to explain what they want included, confirm your understanding, and answer from the supplied information. Do not invent a price, included service, or booking change." },
  { label: "Client ETA update", text: "Give the customer the team arrival estimate that I provide and check whether that timing still works for them. Listen and answer their questions naturally. If no estimate is supplied, explain that you do not have one rather than guessing." },
  { label: "Earlier arrival available", text: "Offer the customer the earlier arrival option that I provide. Ask whether they would prefer it and clarify their answer. Do not invent an available time or claim that their booking has been changed." },
  { label: "Home not ready / team turned away", text: "Discuss why the cleaning could not start using only the facts I provide. Listen to the customer's explanation and clarify what would be needed to proceed. Discuss next steps only when supplied; do not blame the customer or claim to have rescheduled the booking." },
  { label: "Job paused — issue on site", text: "Explain the on-site issue and paused cleaning using only the details I provide. Ask the customer for any relevant clarification, listen to their concerns, and summarize their requested next step. Do not invent a cause, policy, compensation, or action taken." },
];

const teamPresets: readonly InstructionPreset[] = [
  { label: "ETA request", text: "Ask the team member for their current arrival estimate and whether anything is delaying them. Clarify the time and any relevant access or parking issue they mention. Summarize their answer without inventing a job or claiming to have notified the customer." },
  { label: "Schedule confirmation", text: "Ask the team member to confirm the schedule details and availability that I provide. Clarify any conflicts or questions they raise. Do not invent dates, job counts, assignments, or claim to have changed the schedule." },
  { label: "Job status reminder", text: "Ask the team member for the current job status: on the way, arrived, started, paused, or finished. Use only job details I provide, clarify any issue they report, and summarize whether they need office help. Do not claim to have updated the dashboard or contacted anyone." },
  { label: "Confirm job completion", text: "Ask the team member whether the cleaning is complete and whether completion photos and any customer walkthrough are done. Clarify anything still outstanding and summarize their answer. Do not assume completion, photo submission, or a particular job assignment." },
];

export function getAiCallerInstructionPresets(type?: "Customer" | "Lead" | "Team"): readonly InstructionPreset[] {
  return type === "Team" ? teamPresets : customerPresets;
}
