import assert from "node:assert/strict";
import test from "node:test";
import { cacheAcknowledgedMutation, readThoughtSnapshot, SNAPSHOT_KEY, writeThoughtSnapshot } from "../lib/thought-cache.ts";
import { applyOutbox, enqueueMutation, flushOutbox, readOutbox } from "../lib/thought-outbox.ts";

function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
}

const thought = {
  id: "cached", text: "Zapisać pomysł", status: "active",
  createdAt: "2026-10-03T10:00:00.000Z", lastPresentedAt: null, completedAt: null,
};

test("distinguishes an empty offline list from missing or corrupt data", () => {
  const storage = memoryStorage();
  assert.equal(readThoughtSnapshot(storage), null);
  writeThoughtSnapshot(storage, []);
  assert.deepEqual(readThoughtSnapshot(storage), []);
  for (const raw of ["{", "null", '{"version":2,"thoughts":[]}', '{"version":1,"thoughts":[{}]}']) {
    storage.setItem(SNAPSHOT_KEY, raw);
    assert.equal(readThoughtSnapshot(storage), null);
  }
});

test("confirmed create, edit and delete survive a reload without another server read", async () => {
  const storage = memoryStorage();
  writeThoughtSnapshot(storage, []);
  const mutations = [
    { method: "POST", thought },
    { method: "PATCH", thought, changes: { text: "Poprawiony pomysł" } },
    { method: "DELETE", thought },
  ];
  for (const mutation of mutations) {
    const expected = applyOutbox(readThoughtSnapshot(storage), [mutation]);
    enqueueMutation(storage, mutation);
    await flushOutbox(storage, async () => new Response(null, { status: 204 }), undefined, undefined,
      acknowledged => cacheAcknowledgedMutation(storage, acknowledged));
    assert.equal(readOutbox(storage).length, 0);
    assert.deepEqual(readThoughtSnapshot(storage), expected);
  }
});

test("retains a server-confirmed mutation for retry if saving its local snapshot fails", async () => {
  const storage = memoryStorage();
  writeThoughtSnapshot(storage, []);
  enqueueMutation(storage, { method: "POST", thought });
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === SNAPSHOT_KEY) throw new Error("Quota exceeded");
    setItem(key, value);
  };
  const flush = () => flushOutbox(storage, async () => new Response(null, { status: 204 }), undefined, undefined,
    acknowledged => cacheAcknowledgedMutation(storage, acknowledged));
  await assert.rejects(flush(), /Quota exceeded/);
  assert.equal(readOutbox(storage).length, 1);
  assert.deepEqual(applyOutbox(readThoughtSnapshot(storage), readOutbox(storage)), [thought]);
  storage.setItem = setItem;
  await flush();
  assert.equal(readOutbox(storage).length, 0);
  assert.deepEqual(readThoughtSnapshot(storage), [thought]);
});
