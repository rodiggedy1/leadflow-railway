export function createStaffCallRecordingReader(options: { key: string; fetch?: typeof fetch }) {
  return async (providerCallId: string): Promise<string | null> => {
    if (!options.key || !/^AC.+$/.test(providerCallId)) return null;
    const response = await (options.fetch ?? fetch)(`https://api.openphone.com/v1/call-recordings/${encodeURIComponent(providerCallId)}`, {
      headers: { Authorization: options.key, Accept: "application/json" }, redirect: "error",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("STAFF_CALL_RECORDING_UNAVAILABLE");
    const result = await response.json();
    if (!Array.isArray(result?.data)) throw new Error("STAFF_CALL_RECORDING_UNAVAILABLE");
    const recording = result.data.find((entry: any) => entry?.status === "completed" && typeof entry.url === "string" && /^https:\/\//i.test(entry.url));
    return recording?.url ?? null;
  };
}
export async function readStaffCallRecordingUrl(providerCallId: string): Promise<string | null> {
  return createStaffCallRecordingReader({ key: process.env.OPENPHONE_API_KEY ?? "" })(providerCallId);
}
