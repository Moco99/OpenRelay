import type { MessageBus, AgentConfig, SessionMemory } from '@openrelay/core'
import type { IAgentAdapter } from '@openrelay/adapters'
import { serializeWorkingMemory, serializeSessionSummary } from '@openrelay/adapters'
import { SUMMARY_PROMPT } from './prompts.js'

export class SummaryGenerator {
  constructor(
    private adapter: IAgentAdapter,
    private bus: MessageBus,
    private config: AgentConfig,
    private sessionId: string,
  ) {}

  async summarize(): Promise<SessionMemory | null> {
    const allMessages = this.bus.getMessages(this.sessionId)
    if (allMessages.length === 0) return null

    const lastMsg = allMessages[allMessages.length - 1]!
    const latestSummary = this.bus.getLatestSummary(this.sessionId)

    // All current messages are already covered
    if (latestSummary && latestSummary.coveredUpToSeq >= lastMsg.seq) return null

    const afterSeq = latestSummary?.coveredUpToSeq ?? 0
    const newMessages = this.bus.getMessages(this.sessionId, afterSeq)
    const tasks = this.bus.getTasks(this.sessionId)

    const parts: string[] = []
    if (latestSummary) {
      parts.push(serializeSessionSummary(latestSummary.content, latestSummary.coveredUpToSeq))
    }
    parts.push(serializeWorkingMemory(newMessages, tasks))
    const context = parts.join('\n')

    let buffer = ''
    for await (const chunk of this.adapter.send(SUMMARY_PROMPT(context), [])) {
      if (chunk.type === 'text') buffer += chunk.content
      if (chunk.type === 'error') break // non-fatal — skip this summarization
    }

    if (!buffer.trim()) return null

    const tokens = Math.ceil(buffer.length / 4)
    const usage = this.adapter.getTokensUsed()
    this.bus.publish({
      sessionId: this.sessionId,
      fromAgent: this.config.id,
      toAgent: 'session',
      type: 'memory_update',
      payload: { coveredUpToSeq: lastMsg.seq },
      tokensIn: usage.input,
      tokensOut: usage.output,
    })

    return this.bus.addMemory(this.sessionId, 'summary', buffer.trim(), tokens, lastMsg.seq)
  }
}
