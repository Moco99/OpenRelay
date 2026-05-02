import { resolve } from 'path'
import { ConfigError } from './errors.js'
import type {
  AgentConfig, AgentMode, AgentRole, CheckpointEvent,
  ProjectConfig, Provider, SessionConfig,
} from '@openrelay/core'

const VALID_ROLES: AgentRole[] = ['planner', 'coder', 'reviewer']
const VALID_MODES: AgentMode[] = ['api', 'cli']
const VALID_PROVIDERS: Provider[] = ['anthropic', 'google', 'openai']
const VALID_CHECKPOINTS: CheckpointEvent[] = [
  'plan_ready', 'task_done', 'deviation_found', 'review_done', 'budget_warning',
]

const SESSION_DEFAULTS: SessionConfig = {
  maxRetries: 2,
  summaryInterval: 10,
  checkpointTimeout: 300,
  workingDir: '',   // filled in with projectDir
}

export function validateRaw(raw: unknown, projectDir: string): ProjectConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError('crew.md must be a TOML object')
  }
  const obj = raw as Record<string, unknown>

  const agents = validateAgents(obj['agents'], projectDir)
  const session = validateSession(obj['session'], projectDir)

  return { agents, session }
}

// ─── agents ──────────────────────────────────────────────────────────────────

function validateAgents(raw: unknown, projectDir: string): AgentConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ConfigError('must be a non-empty array of [[agents]]', 'agents')
  }

  const seenIds = new Set<string>()
  return raw.map((entry: unknown, i: number) => {
    const agent = validateAgent(entry, i, projectDir)
    if (seenIds.has(agent.id)) {
      throw new ConfigError(`duplicate agent id "${agent.id}"`, `agents[${i}].id`)
    }
    seenIds.add(agent.id)
    return agent
  })
}

function validateAgent(raw: unknown, i: number, projectDir: string): AgentConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError(`agent at index ${i} must be an object`, `agents[${i}]`)
  }
  const a = raw as Record<string, unknown>
  const ctx = (field: string) => `agents[${i}].${field}`

  // id
  if (typeof a['id'] !== 'string' || a['id'].length === 0) {
    throw new ConfigError('required string', ctx('id'))
  }
  if (/\s/.test(a['id'])) {
    throw new ConfigError('must not contain spaces', ctx('id'))
  }
  const id = a['id']

  // role
  if (!VALID_ROLES.includes(a['role'] as AgentRole)) {
    throw new ConfigError(`must be one of: ${VALID_ROLES.join(', ')}`, ctx('role'))
  }
  const role = a['role'] as AgentRole

  // mode
  if (!VALID_MODES.includes(a['mode'] as AgentMode)) {
    throw new ConfigError(`must be one of: ${VALID_MODES.join(', ')}`, ctx('mode'))
  }
  const mode = a['mode'] as AgentMode

  // model
  if (typeof a['model'] !== 'string' || a['model'].length === 0) {
    throw new ConfigError('required string', ctx('model'))
  }
  const model = a['model']

  // token_budget
  if (typeof a['token_budget'] !== 'number' || a['token_budget'] <= 0 || !Number.isInteger(a['token_budget'])) {
    throw new ConfigError('must be a positive integer', ctx('token_budget'))
  }
  const tokenBudget = a['token_budget']

  // provider (required for api mode)
  let provider: Provider | undefined
  if (mode === 'api') {
    if (!VALID_PROVIDERS.includes(a['provider'] as Provider)) {
      throw new ConfigError(`required for api mode, must be one of: ${VALID_PROVIDERS.join(', ')}`, ctx('provider'))
    }
    provider = a['provider'] as Provider
  }

  // cli (required for cli mode)
  let cli: string | undefined
  if (mode === 'cli') {
    if (typeof a['cli'] !== 'string' || a['cli'].length === 0) {
      throw new ConfigError('required string for cli mode', ctx('cli'))
    }
    cli = a['cli']
  }

  // checkpoints
  const rawCheckpoints = a['checkpoints'] ?? []
  if (!Array.isArray(rawCheckpoints)) {
    throw new ConfigError('must be an array', ctx('checkpoints'))
  }
  for (const cp of rawCheckpoints) {
    if (!VALID_CHECKPOINTS.includes(cp as CheckpointEvent)) {
      throw new ConfigError(
        `unknown event "${cp}", valid: ${VALID_CHECKPOINTS.join(', ')}`,
        ctx('checkpoints'),
      )
    }
  }
  const checkpoints = rawCheckpoints as CheckpointEvent[]

  // working_dir (optional, resolved relative to projectDir)
  const rawWorkingDir = typeof a['working_dir'] === 'string' ? a['working_dir'] : '.'
  const workingDir = resolve(projectDir, rawWorkingDir)

  // env (optional)
  const env: Record<string, string> = {}
  if (typeof a['env'] === 'object' && a['env'] !== null) {
    for (const [k, v] of Object.entries(a['env'] as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v
    }
  }

  // system_prompt_extra (optional)
  const systemPromptExtra = typeof a['system_prompt_extra'] === 'string' ? a['system_prompt_extra'] : ''

  return { id, role, mode, provider, model, cli, tokenBudget, checkpoints, workingDir, env, systemPromptExtra }
}

// ─── session ─────────────────────────────────────────────────────────────────

function validateSession(raw: unknown, projectDir: string): SessionConfig {
  const defaults = { ...SESSION_DEFAULTS, workingDir: projectDir }
  if (raw === undefined || raw === null) return defaults
  if (typeof raw !== 'object') {
    throw new ConfigError('must be a [session] table', 'session')
  }
  const s = raw as Record<string, unknown>

  const maxRetries = parsePositiveInt(s['max_retries'], 'session.max_retries') ?? defaults.maxRetries
  const summaryInterval = parsePositiveInt(s['summary_interval'], 'session.summary_interval') ?? defaults.summaryInterval
  const checkpointTimeout = parseNonNegInt(s['checkpoint_timeout'], 'session.checkpoint_timeout') ?? defaults.checkpointTimeout
  const rawWorkingDir = typeof s['working_dir'] === 'string' ? s['working_dir'] : '.'
  const workingDir = resolve(projectDir, rawWorkingDir)

  return { maxRetries, summaryInterval, checkpointTimeout, workingDir }
}

function parsePositiveInt(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
    throw new ConfigError('must be a positive integer', field)
  }
  return v
}

function parseNonNegInt(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ConfigError('must be a non-negative integer', field)
  }
  return v
}
