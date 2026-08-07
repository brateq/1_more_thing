import type { ThoughtRecord } from "@/db/schema";

export type ThoughtStatus = "active" | "done";

export type ThoughtPayload = {
  id: string;
  text: string;
  status: ThoughtStatus;
  createdAt: string;
  lastPresentedAt: string | null;
  completedAt: string | null;
};

function parseDate(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseThought(value: unknown): ThoughtPayload | null {
  if (!value || typeof value !== "object") return null;
  const thought = value as Partial<ThoughtPayload>;
  const text = typeof thought.text === "string" ? thought.text.trim() : "";
  const createdAt = parseDate(thought.createdAt);
  const lastPresentedAt = parseDate(thought.lastPresentedAt, true);
  const completedAt = parseDate(thought.completedAt, true);

  if (
    typeof thought.id !== "string" ||
    thought.id.length < 1 ||
    thought.id.length > 120 ||
    !text ||
    text.length > 280 ||
    (thought.status !== "active" && thought.status !== "done") ||
    !createdAt ||
    lastPresentedAt === undefined ||
    completedAt === undefined
  ) {
    return null;
  }

  return {
    id: thought.id,
    text,
    status: thought.status,
    createdAt: createdAt.toISOString(),
    lastPresentedAt: lastPresentedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
  };
}

export function toDatabaseThought(thought: ThoughtPayload) {
  return {
    id: thought.id,
    text: thought.text,
    status: thought.status,
    createdAt: new Date(thought.createdAt),
    lastPresentedAt: thought.lastPresentedAt
      ? new Date(thought.lastPresentedAt)
      : null,
    completedAt: thought.completedAt ? new Date(thought.completedAt) : null,
    updatedAt: new Date(),
  };
}

export function toThoughtPayload(thought: ThoughtRecord): ThoughtPayload {
  return {
    id: thought.id,
    text: thought.text,
    status: thought.status,
    createdAt: thought.createdAt.toISOString(),
    lastPresentedAt: thought.lastPresentedAt?.toISOString() ?? null,
    completedAt: thought.completedAt?.toISOString() ?? null,
  };
}
