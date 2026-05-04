export type MessageType =
  | 'task_assigned'
  | 'task_result'
  | 'task_progress'
  | 'plan_generated'
  | 'deviation_detected'
  | 'checkpoint_request'
  | 'checkpoint_response'
  | 'memory_update'
  | 'session_end'

export type AgentRole = 'planner' | 'coder' | 'reviewer'
export type AgentMode = 'api' | 'cli'
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed'
export type SessionStatus = 'active' | 'completed' | 'failed' | 'cancelled'
export type AgentStatus = 'idle' | 'working' | 'error'
export type MemoryType = 'working' | 'summary' | 'cold'

export type CheckpointEvent =
  | 'plan_ready'
  | 'task_done'
  | 'deviation_found'
  | 'review_done'
  | 'budget_warning'

export interface Message {
  id: string
  seq: number        // SQLite rowid — monotonically increasing, use for polling
  sessionId: string
  fromAgent: string
  toAgent: string
  type: MessageType
  payload: unknown
  timestamp: number
  tokensIn: number
  tokensOut: number
}

export interface Task {
  id: string
  sessionId: string
  planId: string
  title: string
  description: string
  successCriteria: string
  assignedTo: string
  status: TaskStatus
  retries: number
  planExpectation: string
  actualOutput: string | null
  deviationReport: string | null
  createdAt: number
  updatedAt: number
}

export interface Session {
  id: string
  projectDir: string
  originalTask: string
  status: SessionStatus
  startedAt: number
  endedAt: number | null
  summary: string | null
}

export interface AgentState {
  sessionId: string
  agentId: string
  status: AgentStatus
  tokensIn: number
  tokensOut: number
  costUsd: number
  updatedAt: number
}

export interface SessionMemory {
  id: string
  sessionId: string
  type: MemoryType
  content: string
  createdAt: number
  tokens: number
  coveredUpToSeq: number  // rowid of last message covered; 0 for non-summary entries
}

// ─── Project configuration (parsed from crew.md) 

export type Provider = 'anthropic' | 'google' | 'openai'

export interface AgentConfig {
  id: string
  role: AgentRole
  mode: AgentMode
  provider?: Provider        // required when mode = 'api'
  model: string
  cli?: string               // required when mode = 'cli', e.g. 'claude', 'opencode'
  tokenBudget: number
  checkpoints: CheckpointEvent[]
  workingDir: string         // resolved to absolute path
  env: Record<string, string>
  systemPromptExtra: string
}

export interface SessionConfig {
  maxRetries: number
  summaryInterval: number
  checkpointTimeout: number
  workingDir: string         // resolved to absolute path
}

export interface ProjectConfig {
  agents: AgentConfig[]
  session: SessionConfig
}
