import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { mutationReceipts } from "@/db/schema";
import { getDatabase } from "@/lib/database";

type Result = { status: number; body?: unknown };

export function respondToMutation(request: Request, payload: unknown, mutate: () => Result) {
  const key = request.headers.get("Idempotency-Key");
  const respond = (result: Result) => result.status === 204
    ? new Response(null, { status: 204 })
    : Response.json(result.body, { status: result.status });
  if (!key) return respond(mutate());
  if (!/^[\w-]{1,120}$/.test(key)) {
    return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([request.method, new URL(request.url).pathname, payload]))
    .digest("hex");
  const database = getDatabase();
  return database.transaction(() => {
    const receipt = database.select().from(mutationReceipts)
      .where(eq(mutationReceipts.id, key)).get();
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        return Response.json({ error: "idempotency_conflict" }, { status: 409 });
      }
      return respond({ status: receipt.status, body: receipt.body ? JSON.parse(receipt.body) : undefined });
    }
    const result = mutate();
    if (result.status < 300 || (request.method === "DELETE" && result.status === 404)) {
      database.insert(mutationReceipts).values({
        id: key, fingerprint, status: result.status,
        body: result.body === undefined ? null : JSON.stringify(result.body),
      }).run();
    }
    return respond(result);
  });
}
