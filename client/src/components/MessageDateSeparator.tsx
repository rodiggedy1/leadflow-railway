/**
 * OpenPhone-style date/time separator for SMS conversation threads.
 *
 * Shows "Today", "Yesterday", or "Weekday, Mon D, YYYY, h:mm am/pm"
 * between groups of messages that span different calendar days.
 */

/**
 * Format a timestamp (ms) into an OpenPhone-style label.
 * - Same calendar day → "Today"
 * - Previous calendar day → "Yesterday"
 * - Older → "Tuesday, Oct 4, 2022, 7:50 am"
 */
export function formatMsgDate(ts: number): string {
  const msgDate = new Date(ts);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 86_400_000);
  const startOfMsg = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());

  if (startOfMsg.getTime() === startOfToday.getTime()) {
    // Same day — show "Today, h:mm am/pm"
    const time = msgDate.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `Today, ${time}`;
  }

  if (startOfMsg.getTime() === startOfYesterday.getTime()) {
    const time = msgDate.toLocaleString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `Yesterday, ${time}`;
  }

  // Older — full label like "Tuesday, Oct 4, 2022, 7:50 am"
  return msgDate.toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Returns true if two timestamps fall on different calendar days.
 * Used to decide whether to insert a separator between messages.
 */
export function isDifferentDay(tsA: number, tsB: number): boolean {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

interface MessageDateSeparatorProps {
  label: string;
}

/**
 * Centered gray date label rendered between message groups.
 */
export default function MessageDateSeparator({ label }: MessageDateSeparatorProps) {
  return (
    <div className="flex items-center justify-center my-3">
      <span className="text-xs text-gray-400 font-normal px-3 py-0.5 rounded-full bg-gray-100 select-none">
        {label}
      </span>
    </div>
  );
}
