import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const thoughts = sqliteTable(
  "thoughts",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    status: text("status", { enum: ["active", "done"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastPresentedAt: integer("last_presented_at", {
      mode: "timestamp_ms",
    }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("thought_status_check", sql`${table.status} in ('active', 'done')`),
  ],
);

export type ThoughtRecord = typeof thoughts.$inferSelect;
