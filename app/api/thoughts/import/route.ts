import { thoughts } from "@/db/schema";
import { isAuthenticated, unauthorizedResponse } from "@/lib/auth";
import { getDatabase } from "@/lib/database";
import { parseThought, toDatabaseThought } from "@/lib/thoughts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthenticated(request)) return unauthorizedResponse();

  let values: unknown[];
  try {
    const body = (await request.json()) as { thoughts?: unknown };
    values = Array.isArray(body.thoughts) ? body.thoughts : [];
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (values.length > 2000) {
    return Response.json({ error: "too_many_thoughts" }, { status: 413 });
  }

  const parsed = values.map(parseThought);
  if (parsed.some((thought) => thought === null)) {
    return Response.json({ error: "invalid_thought" }, { status: 400 });
  }

  const validThoughts = parsed.filter((thought) => thought !== null);
  if (validThoughts.length === 0) {
    return Response.json({ imported: 0 });
  }

  const result = getDatabase()
    .insert(thoughts)
    .values(validThoughts.map(toDatabaseThought))
    .onConflictDoNothing()
    .run();

  return Response.json({ imported: result.changes });
}
