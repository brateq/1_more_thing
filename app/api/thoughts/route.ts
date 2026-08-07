import { desc } from "drizzle-orm";
import { thoughts } from "@/db/schema";
import { isAuthenticated, unauthorizedResponse } from "@/lib/auth";
import { getDatabase } from "@/lib/database";
import {
  parseThought,
  toDatabaseThought,
  toThoughtPayload,
} from "@/lib/thoughts";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isAuthenticated(request)) return unauthorizedResponse();

  const rows = getDatabase()
    .select()
    .from(thoughts)
    .orderBy(desc(thoughts.createdAt))
    .all();
  return Response.json(
    { thoughts: rows.map(toThoughtPayload) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isAuthenticated(request)) return unauthorizedResponse();

  let thought;
  try {
    const body = (await request.json()) as { thought?: unknown };
    thought = parseThought(body.thought);
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!thought) {
    return Response.json({ error: "invalid_thought" }, { status: 400 });
  }

  const inserted = getDatabase()
    .insert(thoughts)
    .values(toDatabaseThought(thought))
    .onConflictDoNothing()
    .returning()
    .get();

  if (!inserted) {
    return Response.json({ error: "already_exists" }, { status: 409 });
  }

  return Response.json({ thought: toThoughtPayload(inserted) }, { status: 201 });
}
