import type { MessageBus, AgentConfig } from '@openrelay/core'
import type { TokenUsage } from '@openrelay/adapters'
import type { BudgetStatus } from './types.js'

export class BudgetTracker {
  constructor(
    private bus: MessageBus,
    private sessionId: string,
    private configs: AgentConfig[],
  ) {}

  // Call after every adapter.send() completes to record usage and check thresholds.
  update(agentId: string, usage: TokenUsage): void {
    this.bus.upsertAgentState(this.sessionId, agentId, {
      tokensIn: usage.input,
      tokensOut: usage.output,
    })

    const status = this.getStatus(agentId)
    if (status !== 'ok') {
      this.bus.publish({
        sessionId: this.sessionId,
        fromAgent: 'budget-tracker',
        toAgent: agentId,
        type: 'checkpoint_request',
        payload: {
          event: 'budget_warning',
          status,
          ratio: this.getUsageRatio(agentId),
          agentId,
        },
        tokensIn: 0,
        tokensOut: 0,
      })
    }
  }

  getStatus(agentId: string): BudgetStatus {
    const ratio = this.getUsageRatio(agentId)
    if (ratio >= 1.0) return 'exceeded'
    if (ratio >= 0.9) return 'critical'
    if (ratio >= 0.8) return 'warning'
    return 'ok'
  }

  getUsageRatio(agentId: string): number {
    const config = this.configs.find(c => c.id === agentId)
    if (!config) return 0
    const state = this.bus.getAgentState(this.sessionId, agentId)
    if (!state) return 0
    return (state.tokensIn + state.tokensOut) / config.tokenBudget
  }

  getTotalUsed(agentId: string): number {
    const state = this.bus.getAgentState(this.sessionId, agentId)
    return state ? state.tokensIn + state.tokensOut : 0
  }
}
