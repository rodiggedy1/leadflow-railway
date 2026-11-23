export function formatAiCallerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/VAPI/i.test(message) && /phoneNumber[\s\S]*does not exist/i.test(message)) {
    return "The outbound phone number is not available in the connected Vapi account.";
  }
  if (message && message.length < 200) return message;
  const providerStatus = message.match(/VAPI POST \/call → (\d{3})/i)?.[1];
  return providerStatus ? `Vapi rejected the call (HTTP ${providerStatus}).` : "Failed to connect the call.";
}
