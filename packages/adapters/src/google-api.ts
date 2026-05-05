import type { AgentConfig } from '@openrelay/core'
import type { IAgentAdapter, AgentChunk, ContextMessage, SendOptions, TokenUsage } from './types.js'

export class GoogleAdapter implements IAgentAdapter {
  private usage: TokenUsage = { input: 0, output: 0 }

  constructor(private config: AgentConfig) {}

  async *send(prompt: string, context: ContextMessage[], _options: SendOptions = {}): AsyncGenerator<AgentChunk> {
    const timeout = _options.timeout ?? 120_000
    type GoogleAICtor = new (apiKey: string) => Record<string, unknown>
    let GoogleGenerativeAI: GoogleAICtor
    try {
      // @ts-expect-error — optional peer dep not in package.json; import resolves at runtime
      const mod = await import('@google/generative-ai') as { GoogleGenerativeAI: GoogleAICtor }
      GoogleGenerativeAI = mod.GoogleGenerativeAI
    } catch {
      throw new Error('provider=google requires @google/generative-ai: run "bun add @google/generative-ai"')
    }

    const apiKey = this.config.env['GOOGLE_API_KEY'] ?? process.env['GOOGLE_API_KEY'] ?? ''
    const genai = new GoogleGenerativeAI(apiKey)

    // Build conversation history in Gemini format (role: user | model)
    type GeminiPart = { text: string }
    type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }
    const history: GeminiContent[] = context.map(c => ({
      role: c.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: c.content }],
    }))

    type ModelApi = {
      startChat(opts: { history: GeminiContent[] }): {
        sendMessageStream(msg: string): Promise<{
          stream: AsyncIterable<{ text(): string }>
          response: Promise<{ usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }>
        }>
      }
    }
    const getModel = genai['getGenerativeModel'] as (opts: { model: string }) => ModelApi
    const model = getModel.call(genai, { model: this.config.model })
    const chat = model.startChat({ history })

    // Race the API call against a timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Google API timed out after ${timeout}ms`)), timeout),
    )
    const result = await Promise.race([chat.sendMessageStream(prompt), timeoutPromise])

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) yield { type: 'text', content: text }
    }

    const response = await result.response
    this.usage.input  = response.usageMetadata?.promptTokenCount     ?? 0
    this.usage.output = response.usageMetadata?.candidatesTokenCount ?? 0
    yield { type: 'done', content: '' }
  }

  getTokensUsed(): TokenUsage { return { ...this.usage } }
  async terminate(): Promise<void> {}
}
