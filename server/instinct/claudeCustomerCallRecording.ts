export function createCustomerCallRecordingReader(options: { key: string; fetch?: typeof fetch }) {
  return async (providerCallId: string): Promise<string | null> => {
    if (!options.key || !providerCallId.trim()) return null;
    const response = await (options.fetch ?? fetch)(`https://api.vapi.ai/call/${encodeURIComponent(providerCallId)}/mono-recording`, {
      headers: { Authorization: `Bearer ${options.key}` }, redirect: "manual",
    });
    if (response.status === 404) return null;
    if (response.status !== 302) throw new Error("CUSTOMER_CALL_RECORDING_UNAVAILABLE");
    const location = response.headers.get("location");
    if (!location || !/^https:\/\//i.test(location)) throw new Error("CUSTOMER_CALL_RECORDING_UNAVAILABLE");
    return location;
  };
}
export async function readCustomerCallRecordingUrl(providerCallId: string): Promise<string | null> {
  return createCustomerCallRecordingReader({ key: process.env.VAPI_PRIVATE_KEY ?? "" })(providerCallId);
}
