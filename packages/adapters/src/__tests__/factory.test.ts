import { describe, it, expect } from 'bun:test'
import { createAdapter } from '../factory.js'
import { CliAdapter } from '../cli.js'
import { AnthropicAdapter } from '../anthropic-api.js'
import { OpenAIAdapter } from '../openai-api.js'
import { GoogleAdapter } from '../google-api.js'
import type { AgentConfig } from '@openrelay/core'

const base: AgentConfig = {
  id: 'test', role: 'coder', model: 'some-model',
  tokenBudget: 10000, checkpoints: [], workingDir: '/tmp', env: {}, systemPromptExtra: '',
}

describe('createAdapter', () => {
  it('returns CliAdapter when mode is cli', () => {
    const adapter = createAdapter({ ...base, mode: 'cli', cli: 'claude' })
    expect(adapter).toBeInstanceOf(CliAdapter)
  })

  it('returns AnthropicAdapter when provider is anthropic', () => {
    const adapter = createAdapter({ ...base, mode: 'api', provider: 'anthropic' })
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  it('returns OpenAIAdapter when provider is openai', () => {
    const adapter = createAdapter({ ...base, mode: 'api', provider: 'openai' })
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  it('returns GoogleAdapter when provider is google', () => {
    const adapter = createAdapter({ ...base, mode: 'api', provider: 'google' })
    expect(adapter).toBeInstanceOf(GoogleAdapter)
  })

  it('defaults to AnthropicAdapter when provider is undefined', () => {
    const adapter = createAdapter({ ...base, mode: 'api' })
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })
})
