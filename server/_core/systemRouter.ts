import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

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
