import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EventStore } from "../src/sessions/event-store.js";

test("event store persists updateMode and idempotent command receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-event-store-"));
  const store = new EventStore(join(root, "events.sqlite"));
  store.upsertSession({
    id: "session-1",
    runtimeSessionRef: join(root, "session.jsonl"),
    name: "测试会话",
    workspacePath: join(root, "workspace"),
    modelId: "deepseek-v4-flash",
    runStatus: "idle",
    recoverable: true
  });
  store.appendEvent({
    id: "event-1",
    sequence: 1,
    sessionId: "session-1",
    runId: "run-1",
    runtimeGeneration: 1,
    kind: "message.delta",
    source: "model",
    timestamp: new Date().toISOString(),
    updateMode: "delta",
    payload: { delta: "hello" }
  });
  store.saveRequest("request-1", { accepted: true });
  store.saveRequest("request-1", { accepted: false });

  const events = store.listEvents("session-1");
  assert.equal(events[0]?.updateMode, "delta");
  assert.equal(store.nextSessionSequence("session-1"), 2);
  assert.equal(store.nextRuntimeGeneration("session-1"), 2);
  assert.deepEqual(store.getRequest("request-1"), { accepted: true });
  store.close();
});

test("event store keeps Pi and official DeepSeek sessions isolated by adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-event-adapters-"));
  const store = new EventStore(join(root, "events.sqlite"));
  for (const adapterId of ["pi", "deepseek-official"] as const) {
    store.upsertSession({
      id: `${adapterId}-session`,
      adapterId,
      runtimeSessionRef: `${adapterId}:runtime`,
      name: adapterId,
      workspacePath: join(root, "workspace"),
      modelId: "deepseek-v4-flash",
      runStatus: "idle",
      recoverable: true
    });
  }
  assert.deepEqual(store.listSessions(join(root, "workspace"), "pi").map((entry) => entry.id), ["pi-session"]);
  assert.deepEqual(store.listSessions(join(root, "workspace"), "deepseek-official").map((entry) => entry.id), ["deepseek-official-session"]);
  store.close();
});

test("interrupted sessions become unknown with a durable terminal event", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-event-recovery-"));
  const path = join(root, "events.sqlite");
  const store = new EventStore(path);
  store.upsertSession({
    id: "session-active",
    runtimeSessionRef: join(root, "active.jsonl"),
    name: "在途会话",
    workspacePath: join(root, "workspace"),
    modelId: "deepseek-v4-flash",
    runStatus: "running",
    recoverable: true
  });
  store.appendEvent({ id: "started", sequence: 1, sessionId: "session-active", runId: "run-active", runtimeGeneration: 1, kind: "run.started", source: "harness", timestamp: new Date().toISOString(), payload: { status: "running" } });
  assert.equal(store.recoverInterruptedRuns(), 1);
  assert.equal(store.getSession("session-active")?.runStatus, "unknown");
  const terminal = store.listEvents("session-active").at(-1);
  assert.equal(terminal?.kind, "run.settled");
  assert.equal(terminal?.payload.status, "unknown");
  assert.equal(terminal?.sequence, 2);
  assert.equal(store.nextRuntimeGeneration("session-active"), 3);
  store.close();
});

test("deleting a session removes its persisted history without touching other sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-event-delete-"));
  const store = new EventStore(join(root, "events.sqlite"));
  for (const id of ["delete-me", "keep-me"]) {
    store.upsertSession({
      id,
      runtimeSessionRef: join(root, `${id}.jsonl`),
      name: id,
      workspacePath: join(root, "workspace"),
      modelId: "deepseek-v4-flash",
      runStatus: "completed",
      recoverable: true
    });
    store.appendEvent({ id: `event-${id}`, sequence: 1, sessionId: id, runtimeGeneration: 1, kind: "run.settled", source: "bridge", timestamp: new Date().toISOString(), payload: { status: "completed" } });
    store.saveRequest(`request-${id}`, { requestId: `request-${id}`, accepted: true, sessionId: id });
  }

  assert.equal(store.deleteSession("missing"), undefined);
  assert.equal(store.deleteSession("delete-me")?.runtimeSessionRef, join(root, "delete-me.jsonl"));
  assert.equal(store.getSession("delete-me"), undefined);
  assert.deepEqual(store.listEvents("delete-me"), []);
  assert.equal(store.getRequest("request-delete-me"), undefined);
  assert.ok(store.getSession("keep-me"));
  assert.equal(store.listEvents("keep-me").length, 1);
  assert.ok(store.getRequest("request-keep-me"));
  store.close();
});

test("legacy Pi session references and provider-specific event sources migrate to neutral contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-event-legacy-"));
  const path = join(root, "events.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      pi_session_file TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      model_id TEXT NOT NULL,
      run_status TEXT NOT NULL,
      recoverable INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT,
      runtime_generation INTEGER NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      update_mode TEXT,
      payload_json TEXT NOT NULL,
      raw_json TEXT
    );
    INSERT INTO sessions VALUES (
      'legacy-session', '/tmp/pi-session.jsonl', '旧会话', '/tmp/workspace',
      'deepseek-v4-flash', 'completed', 1, '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
    );
    INSERT INTO events VALUES
      ('legacy-pi', 1, 'legacy-session', 'legacy-run', 1, 'run.started', 'pi', '2026-08-12T00:00:00.000Z', NULL, '{}', NULL),
      ('legacy-model', 2, 'legacy-session', 'legacy-run', 1, 'message.delta', 'deepseek', '2026-08-12T00:00:01.000Z', 'delta', '{}', NULL),
      ('legacy-git', 3, 'legacy-session', 'legacy-run', 1, 'workspace.changed', 'git', '2026-08-12T00:00:02.000Z', 'snapshot', '{}', NULL);
  `);
  legacy.close();

  const store = new EventStore(path);
  assert.equal(store.getRuntimeSessionRef("legacy-session"), "/tmp/pi-session.jsonl");
  assert.deepEqual(store.listEvents("legacy-session").map((event) => event.source), ["harness", "model", "workspace"]);
  store.close();

  const migrated = new DatabaseSync(path);
  const columns = migrated.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "runtime_session_ref"));
  assert.ok(!columns.some((column) => column.name === "pi_session_file"));
  migrated.close();
});
