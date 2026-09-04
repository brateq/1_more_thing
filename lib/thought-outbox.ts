import type { ThoughtPayload } from "./thoughts.ts";

export const OUTBOX_PREFIX = "and-1-more-thing:outbox:v1:";
export const DRAFT_KEY = "and-1-more-thing:draft:v1";

type StorageAccess = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
type Changes = Partial<Pick<ThoughtPayload, "text" | "status" | "lastPresentedAt" | "completedAt">>;

export type ThoughtMutation = {
  id: string;
  order: number;
  method: "POST" | "PATCH" | "DELETE";
  thought: ThoughtPayload;
  changes?: Changes;
};

export function readOutbox(storage: StorageAccess): ThoughtMutation[] {
  const mutations: ThoughtMutation[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(OUTBOX_PREFIX)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    const mutation = JSON.parse(raw) as ThoughtMutation;
    if (
      !mutation || key !== OUTBOX_PREFIX + mutation.id ||
      !Number.isFinite(mutation.order) ||
      !["POST", "PATCH", "DELETE"].includes(mutation.method) ||
      typeof mutation.thought?.id !== "string" ||
      typeof mutation.thought?.text !== "string" ||
      (mutation.method === "PATCH" && (!mutation.changes || typeof mutation.changes !== "object"))
    ) throw new Error("Invalid saved mutation");
    mutations.push(mutation);
  }
  return mutations.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function enqueueMutation(
  storage: StorageAccess,
  mutation: Omit<ThoughtMutation, "id" | "order">,
) {
  const previous = readOutbox(storage);
  const entry: ThoughtMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    order: Math.max(Date.now(), (previous.at(-1)?.order ?? 0) + 1),
  };
  // Separate keys keep another tab from replacing this tab's pending writes.
  storage.setItem(OUTBOX_PREFIX + entry.id, JSON.stringify(entry));
  return entry;
}

export function applyOutbox(thoughts: ThoughtPayload[], mutations: ThoughtMutation[]) {
  const projected = new Map(thoughts.map((thought) => [thought.id, thought]));
  for (const mutation of mutations) {
    const id = mutation.thought.id;
    if (mutation.method === "DELETE") projected.delete(id);
    else if (mutation.method === "POST") projected.set(id, mutation.thought);
    else projected.set(id, { ...(projected.get(id) ?? mutation.thought), ...mutation.changes });
  }
  return [...projected.values()];
}

export class SyncError extends Error {
  status: number;
  constructor(status: number) {
    super(`Synchronization failed: ${status}`);
    this.status = status;
  }
}

export async function flushOutbox(
  storage: StorageAccess,
  request: typeof fetch,
  onAcknowledged: () => void = () => {},
  canContinue: () => boolean = () => true,
) {
  while (canContinue()) {
    const mutation = readOutbox(storage)[0];
    if (!mutation) return;
    const url = mutation.method === "POST"
      ? "/api/thoughts"
      : `/api/thoughts/${encodeURIComponent(mutation.thought.id)}`;
    const response = await request(url, {
      method: mutation.method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": mutation.id },
      body: mutation.method === "DELETE" ? undefined : JSON.stringify(
        mutation.method === "POST" ? { thought: mutation.thought } : mutation.changes,
      ),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && !(mutation.method === "DELETE" && response.status === 404)) {
      throw new SyncError(response.status);
    }
    // Remove only after acknowledgement. A lost response is retried with the same key.
    storage.removeItem(OUTBOX_PREFIX + mutation.id);
    onAcknowledged();
  }
}
