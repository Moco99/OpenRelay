export interface AgentChunk {
  type: 'text' | 'thinking' | 'done' | 'error'
  content: string
  metadata?: { stopReason?: string }
}

export interface ContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TokenUsage {
  input: number
  output: number
}

export interface SendOptions {
  timeout?: number   // ms, default 120_000
}

export interface IAgentAdapter {
  send(prompt: string, context: ContextMessage[], options?: SendOptions): AsyncGenerator<AgentChunk>
  getTokensUsed(): TokenUsage
  terminate(): Promise<void>
}
