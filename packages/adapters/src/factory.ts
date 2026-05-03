import type { AgentConfig } from '@openrelay/core'
import { CliAdapter } from './cli.js'
import { AnthropicAdapter } from './anthropic-api.js'
import { OpenAIAdapter } from './openai-api.js'
import { GoogleAdapter } from './google-api.js'
import type { IAgentAdapter } from './types.js'

export function createAdapter(config: AgentConfig): IAgentAdapter {
  if (config.mode !== 'api') return new CliAdapter(config)

  switch (config.provider) {
    case 'openai':   return new OpenAIAdapter(config)
    case 'google':   return new GoogleAdapter(config)
    case 'anthropic':
    default:         return new AnthropicAdapter(config)
  }
}
