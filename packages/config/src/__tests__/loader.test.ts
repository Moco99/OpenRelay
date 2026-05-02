import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { loadConfig } from '../loader.js'
import { ConfigError } from '../errors.js'

const FIXTURES = join(import.meta.dir, 'fixtures')
const TMP = '/tmp/openrelay-config-test'

describe('loadConfig', () => {
  beforeAll(() => mkdirSync(TMP, { recursive: true }))
  afterAll(() => { try { rmSync(TMP, { recursive: true }) } catch {} })

  describe('file discovery', () => {
    it('loads crew.md from the given directory', () => {
      const config = loadConfig(FIXTURES, {
        crewFile: 'valid-both-agents.toml',
        checkCli: () => true,
      })
      expect(config.agents).toHaveLength(2)
      expect(config.agents[0]!.id).toBe('orchestrator')
      expect(config.agents[1]!.id).toBe('executor')
    })

    it('throws a descriptive error when crew.md is not found', () => {
      expect(() => loadConfig('/nonexistent/path')).toThrow(ConfigError)
      expect(() => loadConfig('/nonexistent/path')).toThrow('crew.md')
    })

    it('throws when the file is not valid TOML', () => {
      const badToml = join(TMP, 'bad.toml')
      writeFileSync(badToml, '[[agents\nbroken toml')
      expect(() => loadConfig(TMP, { crewFile: 'bad.toml' })).toThrow(ConfigError)
    })
  })

  describe('parsing and normalization', () => {
    it('parses session config from file', () => {
      const config = loadConfig(FIXTURES, {
        crewFile: 'valid-both-agents.toml',
        checkCli: () => true,
      })
      expect(config.session.maxRetries).toBe(3)
      expect(config.session.summaryInterval).toBe(8)
      expect(config.session.checkpointTimeout).toBe(120)
    })

    it('resolves agent working_dir as absolute path', () => {
      const config = loadConfig(FIXTURES, {
        crewFile: 'valid-both-agents.toml',
        checkCli: () => true,
      })
      const executor = config.agents.find(a => a.id === 'executor')!
      expect(executor.workingDir).toBe(join(FIXTURES, 'src'))
    })

    it('uses projectDir as default workingDir when not specified', () => {
      const config = loadConfig(FIXTURES, {
        crewFile: 'valid-api-only.toml',
        checkCli: () => true,
      })
      expect(config.agents[0]!.workingDir).toBe(FIXTURES)
    })
  })

  describe('env variable interpolation', () => {
    it('interpolates $VAR references from process.env', () => {
      process.env['TEST_API_KEY'] = 'sk-test-12345'
      const config = loadConfig(FIXTURES, {
        crewFile: 'with-env-vars.toml',
        checkCli: () => true,
      })
      expect(config.agents[0]!.env['ANTHROPIC_API_KEY']).toBe('sk-test-12345')
      delete process.env['TEST_API_KEY']
    })

    it('leaves literal values unchanged', () => {
      const config = loadConfig(FIXTURES, {
        crewFile: 'with-env-vars.toml',
        checkCli: () => true,
      })
      expect(config.agents[0]!.env['CUSTOM_VAR']).toBe('literal-value')
    })
  })

  describe('validation errors', () => {
    it('throws ConfigError for invalid TOML content', () => {
      expect(() => loadConfig(FIXTURES, { crewFile: 'invalid-missing-id.toml' }))
        .toThrow(ConfigError)
    })
  })

  describe('CLI detection', () => {
    it('throws when a cli tool is not found in PATH', () => {
      expect(() => loadConfig(FIXTURES, {
        crewFile: 'valid-both-agents.toml',
        checkCli: (name) => name !== 'opencode',
      })).toThrow(ConfigError)
      expect(() => loadConfig(FIXTURES, {
        crewFile: 'valid-both-agents.toml',
        checkCli: (name) => name !== 'opencode',
      })).toThrow('opencode')
    })

    it('passes when all cli tools are found', () => {
      expect(() => loadConfig(FIXTURES, {
        crewFile: 'valid-both-agents.toml',
        checkCli: () => true,
      })).not.toThrow()
    })
  })
})
