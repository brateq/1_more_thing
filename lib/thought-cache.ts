import { applyOutbox, type ThoughtMutation } from "./thought-outbox.ts";
import { isThought, type ThoughtPayload } from "./thoughts.ts";

export const SNAPSHOT_KEY = "and-1-more-thing:snapshot:v1";
export const OFFLINE_LOCK_KEY = "and-1-more-thing:offline-locked:v1";
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

export function readThoughtSnapshot(storage: StorageAccess): ThoughtPayload[] | null {
  const raw = storage.getItem(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version === 1 && Array.isArray(value.thoughts) && value.thoughts.every(isThought)) {
      return value.thoughts;
    }
  } catch { /* An invalid cache must never prevent an online recovery. */ }
  return null;
}

export function writeThoughtSnapshot(storage: StorageAccess, thoughts: ThoughtPayload[]) {
  storage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 1, thoughts }));
}

// Persist the confirmed result before removing its outbox entry. A reload or
// connection loss between acknowledgement and GET must not lose a saved edit.
export function cacheAcknowledgedMutation(storage: StorageAccess, mutation: ThoughtMutation) {
  writeThoughtSnapshot(storage, applyOutbox(readThoughtSnapshot(storage) ?? [], [mutation]));
}
