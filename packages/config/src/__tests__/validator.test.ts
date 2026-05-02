import { describe, it, expect } from 'bun:test'
import { validateRaw } from '../validator.js'
import { ConfigError } from '../errors.js'

const baseApiAgent = {
  id: 'orchestrator',
  role: 'planner',
  mode: 'api',
  provider: 'anthropic',
  model: 'claude-opus-4-5',
  token_budget: 50000,
  checkpoints: ['plan_ready'],
}

const baseCliAgent = {
  id: 'executor',
  role: 'coder',
  mode: 'cli',
  cli: 'opencode',
  model: 'gemini-2.5-flash',
  token_budget: 200000,
  checkpoints: [],
}

const baseSession = {
  max_retries: 2,
  summary_interval: 10,
  checkpoint_timeout: 300,
  working_dir: '/project',
}

describe('validateRaw', () => {
  describe('valid configs', () => {
    it('accepts a valid api agent', () => {
      const config = validateRaw({ agents: [baseApiAgent] }, '/project')
      expect(config.agents).toHaveLength(1)
      expect(config.agents[0]!.id).toBe('orchestrator')
      expect(config.agents[0]!.role).toBe('planner')
      expect(config.agents[0]!.mode).toBe('api')
      expect(config.agents[0]!.provider).toBe('anthropic')
      expect(config.agents[0]!.tokenBudget).toBe(50000)
      expect(config.agents[0]!.checkpoints).toEqual(['plan_ready'])
    })

    it('accepts a valid cli agent', () => {
      const config = validateRaw({ agents: [baseCliAgent] }, '/project')
      expect(config.agents[0]!.cli).toBe('opencode')
      expect(config.agents[0]!.mode).toBe('cli')
    })

    it('accepts multiple agents', () => {
      const config = validateRaw({ agents: [baseApiAgent, baseCliAgent] }, '/project')
      expect(config.agents).toHaveLength(2)
    })

    it('accepts a full session config', () => {
      const config = validateRaw({ agents: [baseApiAgent], session: baseSession }, '/project')
      expect(config.session.maxRetries).toBe(2)
      expect(config.session.summaryInterval).toBe(10)
      expect(config.session.checkpointTimeout).toBe(300)
    })

    it('applies session defaults when session is omitted', () => {
      const config = validateRaw({ agents: [baseApiAgent] }, '/project')
      expect(config.session.maxRetries).toBe(2)
      expect(config.session.summaryInterval).toBe(10)
      expect(config.session.checkpointTimeout).toBe(300)
    })

    it('applies agent defaults for optional fields', () => {
      const config = validateRaw({ agents: [baseApiAgent] }, '/project')
      expect(config.agents[0]!.workingDir).toBe('/project')
      expect(config.agents[0]!.env).toEqual({})
      expect(config.agents[0]!.systemPromptExtra).toBe('')
    })

    it('resolves relative working_dir against projectDir', () => {
      const agent = { ...baseCliAgent, working_dir: './src' }
      const config = validateRaw({ agents: [agent] }, '/my/project')
      expect(config.agents[0]!.workingDir).toBe('/my/project/src')
    })

    it('accepts empty checkpoints array', () => {
      const agent = { ...baseApiAgent, checkpoints: [] }
      const config = validateRaw({ agents: [agent] }, '/project')
      expect(config.agents[0]!.checkpoints).toEqual([])
    })
  })

  describe('agents array validation', () => {
    it('throws when agents is missing', () => {
      expect(() => validateRaw({}, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({}, '/project')).toThrow('[agents]')
    })

    it('throws when agents is empty', () => {
      expect(() => validateRaw({ agents: [] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [] }, '/project')).toThrow('[agents]')
    })

    it('throws when agents is not an array', () => {
      expect(() => validateRaw({ agents: 'bad' }, '/project')).toThrow(ConfigError)
    })
  })

  describe('agent field validation', () => {
    it('throws when id is missing', () => {
      const agent = { ...baseApiAgent, id: undefined }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('id')
    })

    it('throws when id contains spaces', () => {
      const agent = { ...baseApiAgent, id: 'my agent' }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
    })

    it('throws when role is invalid', () => {
      const agent = { ...baseApiAgent, role: 'hacker' }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('role')
    })

    it('throws when mode is invalid', () => {
      const agent = { ...baseApiAgent, mode: 'grpc' }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('mode')
    })

    it('throws when mode=api but provider is missing', () => {
      const agent = { ...baseApiAgent, provider: undefined }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('provider')
    })

    it('throws when mode=api but provider is invalid', () => {
      const agent = { ...baseApiAgent, provider: 'meta' }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
    })

    it('throws when mode=cli but cli field is missing', () => {
      const agent = { ...baseCliAgent, cli: undefined }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('cli')
    })

    it('throws when model is missing', () => {
      const agent = { ...baseApiAgent, model: undefined }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('model')
    })

    it('throws when token_budget is not a positive number', () => {
      const agent = { ...baseApiAgent, token_budget: -1 }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('token_budget')
    })

    it('throws when token_budget is zero', () => {
      const agent = { ...baseApiAgent, token_budget: 0 }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
    })

    it('throws when two agents share the same id', () => {
      const dup = { ...baseCliAgent, id: 'orchestrator' }
      expect(() => validateRaw({ agents: [baseApiAgent, dup] }, '/project')).toThrow(ConfigError)
    })

    it('throws when checkpoints contains an unknown event', () => {
      const agent = { ...baseApiAgent, checkpoints: ['plan_ready', 'unknown_event'] }
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow(ConfigError)
      expect(() => validateRaw({ agents: [agent] }, '/project')).toThrow('checkpoints')
    })
  })
})
