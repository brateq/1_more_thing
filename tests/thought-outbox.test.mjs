import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOutbox, enqueueMutation, flushOutbox, readOutbox, SyncError,
} from "../lib/thought-outbox.ts";

function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

const thought = {
  id: "offline-thought", text: "Kupić chleb", status: "active",
  createdAt: "2026-09-04T10:00:00.000Z", completedAt: null, lastPresentedAt: null,
};

test("keeps failed writes across reloads and replays create, edit and completion in order", async () => {
  const storage = memoryStorage();
  enqueueMutation(storage, { method: "POST", thought });
  enqueueMutation(storage, { method: "PATCH", thought, changes: { text: "Kupić chleb i mleko" } });
  enqueueMutation(storage, { method: "PATCH", thought, changes: { status: "done", completedAt: thought.createdAt } });
  const before = readOutbox(storage);
  await assert.rejects(flushOutbox(storage, async () => { throw new TypeError("Offline"); }));
  assert.deepEqual(readOutbox(storage), before);
  assert.deepEqual(applyOutbox([], readOutbox(storage)), [{
    ...thought, text: "Kupić chleb i mleko", status: "done", completedAt: thought.createdAt,
  }]);
  const requests = [];
  await flushOutbox(storage, async (url, init) => {
    requests.push({ url, method: init.method, body: JSON.parse(init.body), key: init.headers["Idempotency-Key"] });
    return new Response("{}", { status: 200 });
  });
  assert.deepEqual(requests.map((r) => r.method), ["POST", "PATCH", "PATCH"]);
  assert.deepEqual(requests.map((r) => r.key), before.map((m) => m.id));
  assert.equal(requests[1].body.text, "Kupić chleb i mleko");
  assert.equal(readOutbox(storage).length, 0);
});

test("retries a lost acknowledgement with the same idempotency key", async () => {
  const storage = memoryStorage();
  enqueueMutation(storage, { method: "POST", thought });
  const keys = [];
  await assert.rejects(flushOutbox(storage, async (_url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    throw new TypeError("Response lost after server committed");
  }));
  await flushOutbox(storage, async (_url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    return new Response("{}", { status: 201 });
  });
  assert.equal(keys[0], keys[1]);
  assert.equal(readOutbox(storage).length, 0);
});

test("keeps unauthorized or rejected changes pending and stops subsequent writes", async () => {
  for (const status of [400, 401, 404, 409, 500]) {
    const storage = memoryStorage();
    enqueueMutation(storage, { method: "PATCH", thought, changes: { text: "Nowa treść" } });
    enqueueMutation(storage, { method: "DELETE", thought });
    let calls = 0;
    await assert.rejects(flushOutbox(storage, async () => {
      calls++;
      return new Response("{}", { status });
    }), (error) => error instanceof SyncError && error.status === status);
    assert.equal(calls, 1);
    assert.equal(readOutbox(storage).length, 2);
  }
});

test("pending changes survive server refreshes without replacing unrelated server fields", () => {
  const storage = memoryStorage();
  enqueueMutation(storage, { method: "PATCH", thought, changes: { text: "Lokalna poprawka" } });
  assert.deepEqual(applyOutbox([{ ...thought, status: "done", completedAt: thought.createdAt }], readOutbox(storage)), [{
    ...thought, text: "Lokalna poprawka", status: "done", completedAt: thought.createdAt,
  }]);
  enqueueMutation(storage, { method: "DELETE", thought });
  assert.deepEqual(applyOutbox([thought], readOutbox(storage)), []);
});

test("drains writes added during synchronization and accepts an already deleted thought", async () => {
  const storage = memoryStorage();
  enqueueMutation(storage, { method: "POST", thought });
  let calls = 0;
  await flushOutbox(storage, async () => {
    if (++calls === 1) {
      enqueueMutation(storage, { method: "DELETE", thought });
      return new Response("{}", { status: 201 });
    }
    return new Response("{}", { status: 404 });
  });
  assert.equal(calls, 2);
  assert.equal(readOutbox(storage).length, 0);
});

test("does not report a saved change when local storage fails", () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("Quota exceeded"); };
  assert.throws(() => enqueueMutation(storage, { method: "POST", thought }), /Quota exceeded/);
  assert.equal(readOutbox(storage).length, 0);
});
