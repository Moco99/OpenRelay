import type { MessageBus } from '@openrelay/core'
import { serializeWorkingMemory, serializeSessionSummary } from '@openrelay/adapters'

export function buildContext(bus: MessageBus, sessionId: string): string {
  const latestSummary = bus.getLatestSummary(sessionId)
  const afterSeq = latestSummary?.coveredUpToSeq ?? 0
  const messages = bus.getMessages(sessionId, afterSeq)
  const tasks = bus.getTasks(sessionId)

  const parts: string[] = []
  if (latestSummary) {
    parts.push(serializeSessionSummary(latestSummary.content, latestSummary.coveredUpToSeq))
  }
  if (messages.length > 0) {
    parts.push(serializeWorkingMemory(messages, tasks))
  }
  return parts.join('\n')
}
