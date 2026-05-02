import { Database } from 'bun:sqlite'
import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import type { Message, Task, Session, AgentState } from './types.js'

type SQLValue = string | number | bigint | boolean | null | Uint8Array

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    from_agent  TEXT NOT NULL,
    to_agent    TEXT NOT NULL,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    tokens_in   INTEGER NOT NULL DEFAULT 0,
    tokens_out  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session
    ON messages(session_id, timestamp);

  CREATE TABLE IF NOT EXISTS tasks (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL,
    plan_id           TEXT NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT NOT NULL,
    success_criteria  TEXT NOT NULL,
    assigned_to       TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    retries           INTEGER NOT NULL DEFAULT 0,
    plan_expectation  TEXT NOT NULL,
    actual_output     TEXT,
    deviation_report  TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    project_dir   TEXT NOT NULL,
    original_task TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    summary       TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_state (
    session_id  TEXT NOT NULL,
    agent_id    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'idle',
    tokens_in   INTEGER NOT NULL DEFAULT 0,
    tokens_out  INTEGER NOT NULL DEFAULT 0,
    cost_usd    REAL NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (session_id, agent_id)
  );

  CREATE TABLE IF NOT EXISTS session_memory (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    type        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    tokens      INTEGER NOT NULL DEFAULT 0
  );
`

export class MessageBus {
  private db: Database

  constructor(dbPath: string = '.openrelay/session.db') {
    const dir = dbPath.includes('/') ? dbPath.substring(0, dbPath.lastIndexOf('/')) : null
    if (dir) mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath, { create: true })
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA synchronous = NORMAL')
    this.db.exec(SCHEMA)
  }

  publish(msg: Omit<Message, 'id' | 'seq' | 'timestamp'>): Message {
    const id = randomUUID()
    const timestamp = Date.now()
    this.db.prepare(`
      INSERT INTO messages (id, session_id, from_agent, to_agent, type, payload, timestamp, tokens_in, tokens_out)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.sessionId, msg.fromAgent, msg.toAgent, msg.type, JSON.stringify(msg.payload), timestamp, msg.tokensIn, msg.tokensOut)
    const { seq } = this.db.prepare('SELECT last_insert_rowid() as seq').get() as { seq: number }
    return { ...msg, id, seq, timestamp }
  }

  // afterSeq: only return messages with rowid > afterSeq (use msg.seq for polling)
  getMessages(sessionId: string, afterSeq?: number): Message[] {
    const rows = this.db.prepare(`
      SELECT *, rowid as seq FROM messages
      WHERE session_id = ? AND rowid > ?
      ORDER BY rowid ASC
    `).all(sessionId, afterSeq ?? 0) as RawMessage[]
    return rows.map(rowToMessage)
  }

  createSession(id: string, projectDir: string, originalTask: string): Session {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO sessions (id, project_dir, original_task, status, started_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, projectDir, originalTask, now)
    return { id, projectDir, originalTask, status: 'active', startedAt: now, endedAt: null, summary: null }
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as RawSession | null
    return row ? rowToSession(row) : null
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'status' | 'endedAt' | 'summary'>>): void {
    const fields: string[] = []
    const values: SQLValue[] = []
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.endedAt !== undefined) { fields.push('ended_at = ?'); values.push(updates.endedAt) }
    if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary) }
    if (fields.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  upsertAgentState(
    sessionId: string,
    agentId: string,
    updates: Partial<Omit<AgentState, 'sessionId' | 'agentId' | 'updatedAt'>>,
  ): void {
    const now = Date.now()
    const existing = this.getAgentState(sessionId, agentId)

    if (existing) {
      const fields: string[] = ['updated_at = ?']
      const values: SQLValue[] = [now]
      if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
      if (updates.tokensIn) { fields.push('tokens_in = tokens_in + ?'); values.push(updates.tokensIn) }
      if (updates.tokensOut) { fields.push('tokens_out = tokens_out + ?'); values.push(updates.tokensOut) }
      if (updates.costUsd) { fields.push('cost_usd = cost_usd + ?'); values.push(updates.costUsd) }
      values.push(sessionId, agentId)
      this.db.prepare(`UPDATE agent_state SET ${fields.join(', ')} WHERE session_id = ? AND agent_id = ?`).run(...values)
    } else {
      this.db.prepare(`
        INSERT INTO agent_state (session_id, agent_id, status, tokens_in, tokens_out, cost_usd, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, agentId,
        updates.status ?? 'idle',
        updates.tokensIn ?? 0,
        updates.tokensOut ?? 0,
        updates.costUsd ?? 0,
        now,
      )
    }
  }

  getAgentState(sessionId: string, agentId: string): AgentState | null {
    const row = this.db.prepare(
      'SELECT * FROM agent_state WHERE session_id = ? AND agent_id = ?',
    ).get(sessionId, agentId) as RawAgentState | null
    return row ? rowToAgentState(row) : null
  }

  createTask(task: Omit<Task, 'status' | 'retries' | 'actualOutput' | 'deviationReport' | 'createdAt' | 'updatedAt'>): Task {
    const now = Date.now()
    const full: Task = { ...task, status: 'pending', retries: 0, actualOutput: null, deviationReport: null, createdAt: now, updatedAt: now }
    this.db.prepare(`
      INSERT INTO tasks (id, session_id, plan_id, title, description, success_criteria, assigned_to, status, retries, plan_expectation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `).run(full.id, full.sessionId, full.planId, full.title, full.description, full.successCriteria, full.assignedTo, full.planExpectation, now, now)
    return full
  }

  updateTask(id: string, updates: Partial<Pick<Task, 'status' | 'retries' | 'actualOutput' | 'deviationReport'>>): void {
    const fields: string[] = ['updated_at = ?']
    const values: SQLValue[] = [Date.now()]
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.retries !== undefined) { fields.push('retries = ?'); values.push(updates.retries) }
    if (updates.actualOutput !== undefined) { fields.push('actual_output = ?'); values.push(updates.actualOutput) }
    if (updates.deviationReport !== undefined) { fields.push('deviation_report = ?'); values.push(updates.deviationReport) }
    values.push(id)
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  getTasks(sessionId: string): Task[] {
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC',
    ).all(sessionId) as RawTask[]
    return rows.map(rowToTask)
  }

  close(): void {
    this.db.close()
  }
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

interface RawMessage {
  id: string; seq: number; session_id: string; from_agent: string; to_agent: string
  type: string; payload: string; timestamp: number; tokens_in: number; tokens_out: number
}
interface RawSession {
  id: string; project_dir: string; original_task: string; status: string
  started_at: number; ended_at: number | null; summary: string | null
}
interface RawAgentState {
  session_id: string; agent_id: string; status: string
  tokens_in: number; tokens_out: number; cost_usd: number; updated_at: number
}
interface RawTask {
  id: string; session_id: string; plan_id: string; title: string; description: string
  success_criteria: string; assigned_to: string; status: string; retries: number
  plan_expectation: string; actual_output: string | null; deviation_report: string | null
  created_at: number; updated_at: number
}

function rowToMessage(r: RawMessage): Message {
  return { id: r.id, seq: r.seq, sessionId: r.session_id, fromAgent: r.from_agent, toAgent: r.to_agent, type: r.type as Message['type'], payload: JSON.parse(r.payload), timestamp: r.timestamp, tokensIn: r.tokens_in, tokensOut: r.tokens_out }
}
function rowToSession(r: RawSession): Session {
  return { id: r.id, projectDir: r.project_dir, originalTask: r.original_task, status: r.status as Session['status'], startedAt: r.started_at, endedAt: r.ended_at, summary: r.summary }
}
function rowToAgentState(r: RawAgentState): AgentState {
  return { sessionId: r.session_id, agentId: r.agent_id, status: r.status as AgentState['status'], tokensIn: r.tokens_in, tokensOut: r.tokens_out, costUsd: r.cost_usd, updatedAt: r.updated_at }
}
function rowToTask(r: RawTask): Task {
  return { id: r.id, sessionId: r.session_id, planId: r.plan_id, title: r.title, description: r.description, successCriteria: r.success_criteria, assignedTo: r.assigned_to, status: r.status as Task['status'], retries: r.retries, planExpectation: r.plan_expectation, actualOutput: r.actual_output, deviationReport: r.deviation_report, createdAt: r.created_at, updatedAt: r.updated_at }
}
