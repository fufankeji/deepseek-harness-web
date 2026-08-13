import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AcceptanceRecord, HarnessEvent, RunStatus, SessionSummary } from "../contracts.js";

export class EventStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL DEFAULT 'pi',
        runtime_session_ref TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        model_id TEXT NOT NULL,
        run_status TEXT NOT NULL,
        recoverable INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
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
        raw_json TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_sequence ON events(session_id, sequence);
      CREATE TABLE IF NOT EXISTS requests (
        request_id TEXT PRIMARY KEY,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS acceptance_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
    `);
    migrateRuntimeSessionReference(this.#db);
    ensureColumn(this.#db, "sessions", "adapter_id", "TEXT NOT NULL DEFAULT 'pi'");
    ensureColumn(this.#db, "events", "update_mode", "TEXT");
    migrateEventSequenceScope(this.#db);
    this.#db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '1')").run();
  }

  nextSessionSequence(sessionId: string): number {
    const row = this.#db.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM events WHERE session_id=?").get(sessionId) as { value: number };
    return row.value + 1;
  }

  nextRuntimeGeneration(sessionId: string): number {
    const row = this.#db.prepare("SELECT COALESCE(MAX(runtime_generation), 0) AS value FROM events WHERE session_id=?").get(sessionId) as { value: number };
    return row.value + 1;
  }

  setMetadata(key: string, value: unknown): void {
    this.#db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
  }

  getMetadata<T>(key: string): T | undefined {
    const row = this.#db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  recoverInterruptedRuns(): number {
    const active = ["submitting", "acknowledged", "running", "settling", "interrupting"];
    const placeholders = active.map(() => "?").join(",");
    const rows = this.#db.prepare(`SELECT id FROM sessions WHERE run_status IN (${placeholders})`).all(...active) as Array<{ id: string }>;
    for (const row of rows) {
      const last = this.#db.prepare("SELECT run_id, runtime_generation FROM events WHERE session_id=? AND run_id IS NOT NULL ORDER BY sequence DESC LIMIT 1").get(row.id) as { run_id: string | null; runtime_generation: number } | undefined;
      this.updateSessionStatus(row.id, "unknown");
      this.appendEvent({
        id: randomUUID(),
        sequence: this.nextSessionSequence(row.id),
        sessionId: row.id,
        ...(last?.run_id ? { runId: last.run_id } : {}),
        runtimeGeneration: (last?.runtime_generation ?? 0) + 1,
        kind: "run.settled",
        source: "bridge",
        timestamp: new Date().toISOString(),
        updateMode: "final",
        payload: { status: "unknown", reason: "bridge_restarted_before_terminal_event" }
      });
    }
    return rows.length;
  }

  upsertSession(input: { id: string; adapterId?: string; runtimeSessionRef: string; name: string; workspacePath: string; modelId: string; runStatus: RunStatus; recoverable: boolean }): void {
    const now = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO sessions (id, adapter_id, runtime_session_ref, name, workspace_path, model_id, run_status, recoverable, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        adapter_id=excluded.adapter_id,
        runtime_session_ref=excluded.runtime_session_ref,
        name=excluded.name,
        workspace_path=excluded.workspace_path,
        model_id=excluded.model_id,
        run_status=excluded.run_status,
        recoverable=excluded.recoverable,
        updated_at=excluded.updated_at
    `).run(input.id, input.adapterId ?? "pi", input.runtimeSessionRef, input.name, input.workspacePath, input.modelId, input.runStatus, input.recoverable ? 1 : 0, now, now);
  }

  updateSessionStatus(id: string, status: RunStatus): void {
    this.#db.prepare("UPDATE sessions SET run_status=?, updated_at=? WHERE id=?").run(status, new Date().toISOString(), id);
  }

  getSession(id: string): SessionSummary | undefined {
    const row = this.#db.prepare("SELECT id, name, updated_at, model_id, run_status, recoverable FROM sessions WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? toSessionSummary(row) : undefined;
  }

  listSessions(workspacePath?: string, adapterId?: string): SessionSummary[] {
    const rows = workspacePath && adapterId
      ? this.#db.prepare("SELECT id, name, updated_at, model_id, run_status, recoverable FROM sessions WHERE workspace_path=? AND adapter_id=? ORDER BY updated_at DESC").all(workspacePath, adapterId) as Array<Record<string, unknown>>
      : workspacePath
        ? this.#db.prepare("SELECT id, name, updated_at, model_id, run_status, recoverable FROM sessions WHERE workspace_path=? ORDER BY updated_at DESC").all(workspacePath) as Array<Record<string, unknown>>
        : adapterId
          ? this.#db.prepare("SELECT id, name, updated_at, model_id, run_status, recoverable FROM sessions WHERE adapter_id=? ORDER BY updated_at DESC").all(adapterId) as Array<Record<string, unknown>>
          : this.#db.prepare("SELECT id, name, updated_at, model_id, run_status, recoverable FROM sessions ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map(toSessionSummary);
  }

  getRuntimeSessionRef(id: string): string | undefined {
    const row = this.#db.prepare("SELECT runtime_session_ref FROM sessions WHERE id=?").get(id) as { runtime_session_ref: string } | undefined;
    return row?.runtime_session_ref;
  }

  getSessionWorkspace(id: string): string | undefined {
    const row = this.#db.prepare("SELECT workspace_path FROM sessions WHERE id=?").get(id) as { workspace_path: string } | undefined;
    return row?.workspace_path;
  }

  deleteSession(id: string): { runtimeSessionRef: string; runStatus: RunStatus } | undefined {
    const row = this.#db.prepare("SELECT runtime_session_ref, run_status FROM sessions WHERE id=?").get(id) as { runtime_session_ref: string; run_status: RunStatus } | undefined;
    if (!row) return undefined;
    const requestIds = (this.#db.prepare("SELECT request_id, receipt_json FROM requests").all() as Array<{ request_id: string; receipt_json: string }>)
      .filter((request) => requestSessionId(request.receipt_json) === id)
      .map((request) => request.request_id);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const requestId of requestIds) this.#db.prepare("DELETE FROM requests WHERE request_id=?").run(requestId);
      this.#db.prepare("DELETE FROM events WHERE session_id=?").run(id);
      this.#db.prepare("DELETE FROM sessions WHERE id=?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { runtimeSessionRef: row.runtime_session_ref, runStatus: row.run_status };
  }

  appendEvent(event: HarnessEvent): void {
    this.#db.prepare(`
      INSERT INTO events (id, sequence, session_id, run_id, runtime_generation, kind, source, timestamp, update_mode, payload_json, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.id, event.sequence, event.sessionId, event.runId ?? null, event.runtimeGeneration, event.kind, event.source, event.timestamp, event.updateMode ?? null, JSON.stringify(event.payload), event.raw ? JSON.stringify(event.raw) : null);
  }

  listEvents(sessionId: string, after = 0): HarnessEvent[] {
    const rows = this.#db.prepare("SELECT * FROM events WHERE session_id=? AND sequence>? ORDER BY sequence").all(sessionId, after) as Array<Record<string, unknown>>;
    return rows.map(toHarnessEvent);
  }

  saveRequest(requestId: string, receipt: unknown): void {
    this.#db.prepare("INSERT OR IGNORE INTO requests (request_id, receipt_json, created_at) VALUES (?, ?, ?)").run(requestId, JSON.stringify(receipt), new Date().toISOString());
  }

  getRequest<T>(requestId: string): T | undefined {
    const row = this.#db.prepare("SELECT receipt_json FROM requests WHERE request_id=?").get(requestId) as { receipt_json: string } | undefined;
    return row ? JSON.parse(row.receipt_json) as T : undefined;
  }

  saveAcceptanceRecord(record: AcceptanceRecord): void {
    this.#db.prepare("INSERT INTO acceptance_records (id, created_at, record_json) VALUES (?, ?, ?)").run(record.id, record.createdAt, JSON.stringify(record));
  }

  listAcceptanceRecords(): AcceptanceRecord[] {
    const rows = this.#db.prepare("SELECT record_json FROM acceptance_records ORDER BY created_at DESC").all() as Array<{ record_json: string }>;
    return rows.map((row) => normalizeAcceptanceRecord(JSON.parse(row.record_json) as Record<string, unknown>));
  }

  getAcceptanceRecord(id: string): AcceptanceRecord | undefined {
    const row = this.#db.prepare("SELECT record_json FROM acceptance_records WHERE id=?").get(id) as { record_json: string } | undefined;
    return row ? normalizeAcceptanceRecord(JSON.parse(row.record_json) as Record<string, unknown>) : undefined;
  }

  close(): void {
    this.#db.close();
  }
}

export class AcceptanceRecordStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS acceptance_records (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
    `);
  }

  save(record: AcceptanceRecord): void {
    this.#db.prepare("INSERT OR IGNORE INTO acceptance_records (id, created_at, record_json) VALUES (?, ?, ?)").run(record.id, record.createdAt, JSON.stringify(record));
  }

  list(): AcceptanceRecord[] {
    const rows = this.#db.prepare("SELECT record_json FROM acceptance_records ORDER BY created_at DESC").all() as Array<{ record_json: string }>;
    return rows.map((row) => normalizeAcceptanceRecord(JSON.parse(row.record_json) as Record<string, unknown>));
  }

  get(id: string): AcceptanceRecord | undefined {
    const row = this.#db.prepare("SELECT record_json FROM acceptance_records WHERE id=?").get(id) as { record_json: string } | undefined;
    return row ? normalizeAcceptanceRecord(JSON.parse(row.record_json) as Record<string, unknown>) : undefined;
  }

  close(): void {
    this.#db.close();
  }
}

function requestSessionId(receiptJson: string): string | undefined {
  try {
    const value = JSON.parse(receiptJson) as { sessionId?: unknown };
    return typeof value.sessionId === "string" ? value.sessionId : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAcceptanceRecord(value: Record<string, unknown>): AcceptanceRecord {
  const legacyPiVersion = typeof value.piVersion === "string" ? value.piVersion : "unknown";
  const finalStatus = typeof value.finalStatus === "string" ? value.finalStatus as RunStatus : "unknown";
  const templateVersion = typeof value.workspaceTemplateVersion === "string" ? value.workspaceTemplateVersion : "unknown";
  const expectedFinalStatus: RunStatus = typeof value.expectedFinalStatus === "string"
    ? value.expectedFinalStatus as RunStatus
    : templateVersion === "control-v1" ? "cancelled" : "completed";
  const verification = typeof value.verification === "object" && value.verification !== null
    ? value.verification as { passed?: unknown }
    : {};
  return {
    ...value,
    adapterId: typeof value.adapterId === "string" ? value.adapterId : "unknown",
    adapterVersion: typeof value.adapterVersion === "string" ? value.adapterVersion : "0.1.0",
    harnessId: typeof value.harnessId === "string" ? value.harnessId : "pi",
    harnessVersion: typeof value.harnessVersion === "string" ? value.harnessVersion : legacyPiVersion,
    expectedFinalStatus,
    passed: typeof value.passed === "boolean" ? value.passed : verification.passed === true && finalStatus === expectedFinalStatus,
    eventKinds: Array.isArray(value.eventKinds) ? value.eventKinds.map(String) : [],
    eventSequence: typeof value.eventSequence === "object" && value.eventSequence !== null
      ? value.eventSequence as { first: number; last: number }
      : { first: 0, last: 0 }
  } as unknown as AcceptanceRecord;
}

function migrateEventSequenceScope(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'").get() as { sql: string } | undefined;
  if (!row?.sql.includes("sequence INTEGER NOT NULL UNIQUE")) return;
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    DROP INDEX IF EXISTS idx_events_session_sequence;
    ALTER TABLE events RENAME TO events_legacy_global_sequence;
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
      raw_json TEXT,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    INSERT INTO events
      SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY sequence), session_id, run_id, runtime_generation, kind, source, timestamp, update_mode, payload_json, raw_json
      FROM events_legacy_global_sequence;
    DROP TABLE events_legacy_global_sequence;
    CREATE UNIQUE INDEX idx_events_session_sequence ON events(session_id, sequence);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function toSessionSummary(row: Record<string, unknown>): SessionSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    updatedAt: String(row.updated_at),
    modelId: String(row.model_id),
    runStatus: String(row.run_status) as RunStatus,
    recoverable: Number(row.recoverable) === 1
  };
}

function toHarnessEvent(row: Record<string, unknown>): HarnessEvent {
  const runId = row.run_id === null ? undefined : String(row.run_id);
  const raw = row.raw_json === null ? undefined : JSON.parse(String(row.raw_json)) as Record<string, unknown>;
  return {
    id: String(row.id),
    sequence: Number(row.sequence),
    sessionId: String(row.session_id),
    ...(runId ? { runId } : {}),
    runtimeGeneration: Number(row.runtime_generation),
    kind: String(row.kind) as HarnessEvent["kind"],
    source: normalizeEventSource(String(row.source)),
    timestamp: String(row.timestamp),
    ...(row.update_mode === null ? {} : { updateMode: String(row.update_mode) as NonNullable<HarnessEvent["updateMode"]> }),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    ...(raw ? { raw } : {})
  };
}

function normalizeEventSource(source: string): HarnessEvent["source"] {
  if (source === "pi" || source === "harness") return "harness";
  if (source === "deepseek" || source === "model") return "model";
  if (source === "git" || source === "workspace") return "workspace";
  return "bridge";
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateRuntimeSessionReference(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === "pi_session_file") && !columns.some((entry) => entry.name === "runtime_session_ref")) {
    db.exec("ALTER TABLE sessions RENAME COLUMN pi_session_file TO runtime_session_ref");
  }
}
