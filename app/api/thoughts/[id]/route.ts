import { eq } from "drizzle-orm";
import { thoughts } from "@/db/schema";
import { isAuthenticated, unauthorizedResponse } from "@/lib/auth";
import { getDatabase } from "@/lib/database";
import { respondToMutation } from "@/lib/idempotency";
import { toThoughtPayload, type ThoughtStatus } from "@/lib/thoughts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseNullableDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isAuthenticated(request)) return unauthorizedResponse();
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const update: {
    text?: string;
    status?: ThoughtStatus;
    lastPresentedAt?: Date | null;
    completedAt?: Date | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if ("text" in body) {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 280) {
      return Response.json({ error: "invalid_text" }, { status: 400 });
    }
    update.text = text;
  }

  if ("status" in body) {
    if (body.status !== "active" && body.status !== "done") {
      return Response.json({ error: "invalid_status" }, { status: 400 });
    }
    update.status = body.status;
  }

  for (const field of ["lastPresentedAt", "completedAt"] as const) {
    if (field in body) {
      const date = parseNullableDate(body[field]);
      if (date === undefined) {
        return Response.json({ error: "invalid_date" }, { status: 400 });
      }
      update[field] = date;
    }
  }

  if (Object.keys(update).length === 1) {
    return Response.json({ error: "empty_update" }, { status: 400 });
  }

  return respondToMutation(request, body, () => {
    const updated = getDatabase()
      .update(thoughts)
      .set(update)
      .where(eq(thoughts.id, id))
      .returning()
      .get();

    if (!updated) return { status: 404, body: { error: "not_found" } };
    return { status: 200, body: { thought: toThoughtPayload(updated) } };
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isAuthenticated(request)) return unauthorizedResponse();
  const { id } = await context.params;
  return respondToMutation(request, null, () => {
    const deleted = getDatabase()
      .delete(thoughts)
      .where(eq(thoughts.id, id))
      .returning({ id: thoughts.id })
      .get();

    if (!deleted) return { status: 404, body: { error: "not_found" } };
    return { status: 204 };
  });
}
