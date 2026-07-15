import { z } from "zod";
import { router, publicProcedure, adminAgentProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { responseTemplates } from "../drizzle/schema";
import { eq, asc } from "drizzle-orm";

export const responseTemplatesRouter = router({
  /** List all templates — available to all agents */
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(responseTemplates)
      .orderBy(asc(responseTemplates.sortOrder), asc(responseTemplates.category), asc(responseTemplates.title));
  }),

  /** Create a new template — admin only */
  create: adminAgentProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      category: z.string().min(1).max(100),
      description: z.string().max(500).default(""),
      message: z.string().min(1),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [result] = await db.insert(responseTemplates).values({
        title: input.title,
        category: input.category,
        description: input.description,
        message: input.message,
        sortOrder: input.sortOrder,
      } as any);
      return { id: (result as any).insertId };
    }),

  /** Update an existing template — admin only */
  update: adminAgentProcedure
    .input(z.object({
      id: z.number().int(),
      title: z.string().min(1).max(255).optional(),
      category: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      message: z.string().min(1).optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const { id, ...fields } = input;
      const update: Record<string, unknown> = {};
      if (fields.title !== undefined) update.title = fields.title;
      if (fields.category !== undefined) update.category = fields.category;
      if (fields.description !== undefined) update.description = fields.description;
      if (fields.message !== undefined) update.message = fields.message;
      if (fields.sortOrder !== undefined) update.sortOrder = fields.sortOrder;
      if (Object.keys(update).length === 0) return { ok: true };
      await db.update(responseTemplates).set(update as any).where(eq(responseTemplates.id, id));
      return { ok: true };
    }),

  /** Delete a template — admin only */
  delete: adminAgentProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.delete(responseTemplates).where(eq(responseTemplates.id, input.id));
      return { ok: true };
    }),
});
