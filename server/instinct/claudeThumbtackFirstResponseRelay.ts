export const THUMBTACK_FIRST_RESPONSE_OWNER_URL = "https://quote.maidinblack.com/api/webhooks/thumbtack-capture/first-response";

export function thumbtackFirstResponseIsRelay(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RAILWAY_ENVIRONMENT_NAME === "preview" || env.PREVIEW_MODE === "true";
}

/** Forward only the durable capture ID; do not recapture the payload or run an AI in Preview. */
export async function relayClaudeThumbtackFirstResponse(captureId: number): Promise<void> {
  if (!Number.isSafeInteger(captureId) || captureId <= 0) throw new Error("THUMBTACK_CAPTURE_ID_MISSING");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("THUMBTACK_FIRST_RESPONSE_RELAY_AUTH_MISSING");
  const response = await fetch(THUMBTACK_FIRST_RESPONSE_OWNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify({ captureId }),
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`THUMBTACK_FIRST_RESPONSE_RELAY_HTTP_${response.status}`);
}
