import type { AgentConfig } from '@openrelay/core'
import type { IAgentAdapter, AgentChunk, ContextMessage, SendOptions, TokenUsage } from './types.js'

export class AnthropicAdapter implements IAgentAdapter {
  private usage: TokenUsage = { input: 0, output: 0 }

  constructor(private config: AgentConfig) {}

  async *send(prompt: string, context: ContextMessage[], _options: SendOptions = {}): AsyncGenerator<AgentChunk> {
    type AnthropicCtor = new (opts: { apiKey?: string }) => Record<string, unknown>
    let Anthropic: AnthropicCtor
    try {
      // @ts-expect-error — optional peer dep not in package.json; import resolves at runtime
      const mod = await import('@anthropic-ai/sdk') as { default: AnthropicCtor }
      Anthropic = mod.default
    } catch {
      throw new Error('provider=anthropic requires @anthropic-ai/sdk: run "bun add @anthropic-ai/sdk"')
    }

    const apiKey = this.config.env['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY']
    const clientOpts: { apiKey?: string } = apiKey !== undefined ? { apiKey } : {}
    const client = new Anthropic(clientOpts)

    const messages = [
      ...context.map(c => ({ role: c.role, content: c.content })),
      { role: 'user' as const, content: prompt },
    ]

    type StreamType = AsyncIterable<Record<string, unknown>> & {
      finalMessage(): Promise<{ usage: { input_tokens: number; output_tokens: number } }>
    }
    const messagesApi = client['messages'] as Record<string, unknown>
    const streamFn = messagesApi['stream'] as (opts: unknown) => StreamType
    const stream = streamFn.call(messagesApi, { model: this.config.model, max_tokens: 8096, messages })

    for await (const event of stream) {
      if (
        event['type'] === 'content_block_delta' &&
        typeof event['delta'] === 'object' && event['delta'] !== null &&
        (event['delta'] as Record<string, unknown>)['type'] === 'text_delta'
      ) {
        yield { type: 'text', content: String((event['delta'] as Record<string, unknown>)['text'] ?? '') }
      }
    }

    const final = await stream.finalMessage()
    this.usage.input  = final.usage.input_tokens
    this.usage.output = final.usage.output_tokens
    yield { type: 'done', content: '' }
  }

  getTokensUsed(): TokenUsage { return { ...this.usage } }
  async terminate(): Promise<void> {}
}
