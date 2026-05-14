// Owner notifications via ntfy.sh
// Set NTFY_TOPIC to your private ntfy topic (e.g. "leadflow-rohan-abc123")
// Install the ntfy app on your phone and subscribe to that topic

export type NotificationPayload = {
  title: string;
  content: string;
};

/**
 * Sends a push notification to the owner via ntfy.sh.
 * Returns true on success, false if the service is unavailable.
 * Never throws — callers treat this as fire-and-forget.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  const topic = process.env.NTFY_TOPIC;

  if (!topic) {
    console.warn("[Notification] NTFY_TOPIC not set — skipping notification");
    return false;
  }

  const title = (payload.title ?? "").trim().slice(0, 250);
  const content = (payload.content ?? "").trim().slice(0, 4096);

  if (!title) return false;

  try {
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Title": title,
        "Content-Type": "text/plain",
      },
      body: content || title,
    });

    if (!response.ok) {
      console.warn(`[Notification] ntfy failed: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn("[Notification] ntfy error:", error);
    return false;
  }
}
