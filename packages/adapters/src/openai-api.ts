import type { AgentConfig } from '@openrelay/core'
import type { IAgentAdapter, AgentChunk, ContextMessage, SendOptions, TokenUsage } from './types.js'

export class OpenAIAdapter implements IAgentAdapter {
  private usage: TokenUsage = { input: 0, output: 0 }

  constructor(private config: AgentConfig) {}

  async *send(prompt: string, context: ContextMessage[], _options: SendOptions = {}): AsyncGenerator<AgentChunk> {
    type OpenAICtor = new (opts: { apiKey?: string }) => Record<string, unknown>
    let OpenAI: OpenAICtor
    try {
      // @ts-expect-error — optional peer dep not in package.json; import resolves at runtime
      const mod = await import('openai') as { default: OpenAICtor }
      OpenAI = mod.default
    } catch {
      throw new Error('provider=openai requires openai: run "bun add openai"')
    }

    const apiKey = this.config.env['OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY']
    const clientOpts: { apiKey?: string } = apiKey !== undefined ? { apiKey } : {}
    const client = new OpenAI(clientOpts)

    const messages = [
      ...context.map(c => ({ role: c.role, content: c.content })),
      { role: 'user' as const, content: prompt },
    ]

    type StreamChunk = {
      choices: Array<{ delta: { content?: string | null } }>
      usage?: { prompt_tokens: number; completion_tokens: number } | null
    }
    const completionsApi = (client['chat'] as Record<string, unknown>)['completions'] as Record<string, unknown>
    const createFn = completionsApi['create'] as (opts: unknown) => AsyncIterable<StreamChunk>
    const stream = createFn.call(completionsApi, {
      model: this.config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) yield { type: 'text', content: text }
      if (chunk.usage) {
        this.usage.input  = chunk.usage.prompt_tokens
        this.usage.output = chunk.usage.completion_tokens
      }
    }

    yield { type: 'done', content: '' }
  }

  getTokensUsed(): TokenUsage { return { ...this.usage } }
  async terminate(): Promise<void> {}
}
