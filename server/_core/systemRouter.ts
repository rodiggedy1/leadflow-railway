import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { ENV } from "./env";

export const systemRouter = router({
  widgetHealth: adminProcedure
    .query(async () => {
      const widgetUrl = "https://leadflowqf-caerhauj.manus.space/api/widget.js";
      try {
        const res = await fetch(widgetUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          return { ok: false, version: null, error: `HTTP ${res.status}`, checkedAt: new Date() };
        }
        const text = await res.text();
        const isValidJs = text.trimStart().startsWith("(function");
        const versionMatch = text.match(/window\.__MIB_WIDGET_VERSION__\s*=\s*['"]([^'"]+)['"]/);
        const version = versionMatch?.[1] ?? null;
        if (!isValidJs) {
          return { ok: false, version: null, error: "Response is not valid widget JS", checkedAt: new Date() };
        }
        return { ok: true, version, error: null, checkedAt: new Date() };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, version: null, error: message, checkedAt: new Date() };
      }
    }),

  webhookHealth: adminProcedure
    .query(async () => {
      const apiKey = ENV.openPhoneApiKey;
      if (!apiKey) {
        return { ok: false, status: "disabled", url: null, error: "OPENPHONE_API_KEY not set", checkedAt: new Date() };
      }
      try {
        const res = await fetch("https://api.openphone.com/v1/webhooks", {
          headers: { "Authorization": apiKey },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          return { ok: false, status: "error", url: null, error: `OpenPhone API ${res.status}`, checkedAt: new Date() };
        }
        const data = await res.json() as { data: Array<{ id: string; status: string; url: string; label: string | null; events: string[] }> };
        const webhooks = data.data ?? [];
        // Find our LeadFlow webhook
        const ours = webhooks.find(w =>
          w.url?.includes("leadflowqf") || w.url?.includes("quote.maidinblack") || w.label?.includes("LeadFlow")
        );
        if (!ours) {
          return { ok: false, status: "not_found", url: null, error: "Webhook not registered in OpenPhone", checkedAt: new Date() };
        }
        const isEnabled = ours.status === "enabled";
        return {
          ok: isEnabled,
          status: ours.status,
          url: ours.url,
          error: isEnabled ? null : `Webhook is ${ours.status}`,
          checkedAt: new Date(),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: "error", url: null, error: message, checkedAt: new Date() };
      }
    }),

  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
