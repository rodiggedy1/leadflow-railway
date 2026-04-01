import { describe, it, expect } from "vitest";
import "dotenv/config";

describe("Deepgram API key validation", () => {
  it("should authenticate with Deepgram and return a valid projects list", async () => {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    expect(apiKey, "DEEPGRAM_API_KEY must be set").toBeTruthy();

    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    expect(res.status, `Deepgram auth failed with status ${res.status}`).toBe(200);
    const data = await res.json() as { projects: unknown[] };
    expect(Array.isArray(data.projects)).toBe(true);
  });
});
