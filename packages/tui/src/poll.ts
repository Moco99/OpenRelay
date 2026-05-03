import type { MessageBus, Message } from '@openrelay/core'

export type CheckpointDecision = 'approved' | 'rejected' | 'skipped'

export interface ActiveCheckpoint {
  messageId: string
  event: string
  agentId: string
  payload: Record<string, unknown>
}

export function fetchNewMessages(bus: MessageBus, sessionId: string, afterSeq: number): Message[] {
  return bus.getMessages(sessionId, afterSeq)
}

export function findNextCheckpoint(
  messages: Message[],
  handled: Set<string>,
): Message | undefined {
  return messages.find(m => m.type === 'checkpoint_request' && !handled.has(m.id))
}

export function parseCheckpoint(msg: Message): ActiveCheckpoint {
  const payload = msg.payload as Record<string, unknown>
  return {
    messageId: msg.id,
    event:   String(payload['event']   ?? 'checkpoint'),
    agentId: String(payload['agentId'] ?? msg.fromAgent),
    payload,
  }
}

export function publishCheckpointResponse(
  bus: MessageBus,
  sessionId: string,
  checkpoint: ActiveCheckpoint,
  decision: CheckpointDecision,
  feedback?: string,
): void {
  bus.publish({
    sessionId,
    fromAgent: 'human',
    toAgent: checkpoint.agentId,
    type: 'checkpoint_response',
    payload: { decision, feedback, checkpointMessageId: checkpoint.messageId },
    tokensIn: 0,
    tokensOut: 0,
  })
}
