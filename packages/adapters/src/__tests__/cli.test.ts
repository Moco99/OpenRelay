import { describe, it, expect, beforeAll } from 'bun:test'
import { writeFileSync, chmodSync } from 'fs'
import { CliAdapter } from '../cli.js'
import type { AgentConfig } from '@openrelay/core'

// Temporary mock CLIs written to /tmp at test time
const MOCK_STREAM_CLI = '/tmp/openrelay-mock-stream-cli'
const MOCK_PLAIN_CLI = '/tmp/openrelay-mock-plain-cli'
const MOCK_FAIL_CLI = '/tmp/openrelay-mock-fail-cli'

beforeAll(() => {
  writeFileSync(MOCK_STREAM_CLI, `#!/bin/sh\necho '{"type":"text","text":"generated code here"}'\necho '{"type":"result","usage":{"input_tokens":42,"output_tokens":18}}'`)
  chmodSync(MOCK_STREAM_CLI, 0o755)
  writeFileSync(MOCK_PLAIN_CLI, `#!/bin/sh\necho "plain output line"`)
  chmodSync(MOCK_PLAIN_CLI, 0o755)
  writeFileSync(MOCK_FAIL_CLI, `#!/bin/sh\nexit 1`)
  chmodSync(MOCK_FAIL_CLI, 0o755)
})

const baseConfig: AgentConfig = {
  id: 'executor', role: 'coder', mode: 'cli', cli: 'echo',
  model: 'test-model', tokenBudget: 10000,
  workingDir: '/tmp', checkpoints: [], env: {}, systemPromptExtra: '',
}

async function collect(gen: AsyncGenerator<import('../types.js').AgentChunk>): Promise<import('../types.js').AgentChunk[]> {
  const chunks: import('../types.js').AgentChunk[] = []
  for await (const chunk of gen) chunks.push(chunk)
  return chunks
}

describe('CliAdapter', () => {
  describe('plain text output', () => {
    it('yields text chunks and a done chunk for plain output', async () => {
      const adapter = new CliAdapter(baseConfig)
      const chunks = await collect(adapter.send('hello world', []))

      const textChunks = chunks.filter(c => c.type === 'text')
      const doneChunks = chunks.filter(c => c.type === 'done')
      expect(textChunks.length).toBeGreaterThan(0)
      expect(doneChunks).toHaveLength(1)
    })

    it('text chunk contains the echoed content', async () => {
      const adapter = new CliAdapter(baseConfig)
      const chunks = await collect(adapter.send('hello world', []))
      const text = chunks.filter(c => c.type === 'text').map(c => c.content).join('')
      expect(text).toContain('hello world')
    })
  })

  describe('stream-json output', () => {
    it('parses Claude Code stream-json text events', async () => {
      const config: AgentConfig = { ...baseConfig, cli: MOCK_STREAM_CLI }
      const adapter = new CliAdapter(config)
      const chunks = await collect(adapter.send('ignored', []))
      const textChunks = chunks.filter(c => c.type === 'text')
      expect(textChunks.some(c => c.content.includes('generated code'))).toBe(true)
    })

    it('updates token usage from stream-json result event', async () => {
      const config: AgentConfig = { ...baseConfig, cli: MOCK_STREAM_CLI }
      const adapter = new CliAdapter(config)
      await collect(adapter.send('ignored', []))
      const usage = adapter.getTokensUsed()
      expect(usage.input).toBe(42)
      expect(usage.output).toBe(18)
    })

    it('falls back to plain text for non-JSON lines', async () => {
      const config: AgentConfig = { ...baseConfig, cli: MOCK_PLAIN_CLI }
      const adapter = new CliAdapter(config)
      const chunks = await collect(adapter.send('ignored', []))
      const textChunks = chunks.filter(c => c.type === 'text')
      expect(textChunks.some(c => c.content.includes('plain output'))).toBe(true)
    })
  })

  describe('token estimation', () => {
    it('estimates input tokens from prompt length', async () => {
      const adapter = new CliAdapter(baseConfig)
      const prompt = 'x'.repeat(400)  // 400 chars → ~100 tokens
      await collect(adapter.send(prompt, []))
      const usage = adapter.getTokensUsed()
      expect(usage.input).toBeGreaterThan(0)
    })

    it('getTokensUsed returns a copy (not live reference)', async () => {
      const adapter = new CliAdapter(baseConfig)
      const usage1 = adapter.getTokensUsed()
      await collect(adapter.send('test', []))
      const usage2 = adapter.getTokensUsed()
      expect(usage1).not.toBe(usage2)
    })
  })

  describe('error handling', () => {
    it('yields error chunk when CLI exits with non-zero code', async () => {
      const config: AgentConfig = { ...baseConfig, cli: MOCK_FAIL_CLI }
      const adapter = new CliAdapter(config)
      const chunks = await collect(adapter.send('ignored', []))
      expect(chunks.some(c => c.type === 'error')).toBe(true)
    })

    it('terminate resolves without throwing', async () => {
      const adapter = new CliAdapter(baseConfig)
      await expect(adapter.terminate()).resolves.toBeUndefined()
    })
  })
})
