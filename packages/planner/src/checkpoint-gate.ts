import type { MessageBus } from '@openrelay/core'
import type { CheckpointDecision } from './types.js'

export class CheckpointGate {
  constructor(
    private bus: MessageBus,
    private sessionId: string,
    private pollIntervalMs = 200,
    private defaultTimeoutMs = 300_000,
  ) {}

  async waitForResponse(
    checkpointMessageId: string,
    timeoutMs?: number,
  ): Promise<CheckpointDecision> {
    const deadline = Date.now() + (timeoutMs ?? this.defaultTimeoutMs)
    while (Date.now() < deadline) {
      const msgs = this.bus.getMessages(this.sessionId)
      const response = msgs.find(m => {
        if (m.type !== 'checkpoint_response') return false
        const p = m.payload as Record<string, unknown>
        return p['checkpointMessageId'] === checkpointMessageId
      })
      if (response) {
        const p = response.payload as Record<string, unknown>
        return (p['decision'] as CheckpointDecision) ?? 'approved'
      }
      await new Promise<void>(r => setTimeout(r, this.pollIntervalMs))
    }
    return 'approved'
  }
}
