import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { BudgetTracker } from '../budget-tracker.js'
import type { AgentConfig } from '@openrelay/core'

function makeConfig(id: string, budget: number): AgentConfig {
  return {
    id, role: 'planner', mode: 'cli', cli: 'claude',
    model: 'claude-opus-4-5', tokenBudget: budget, checkpoints: [],
    workingDir: '/tmp', env: {}, systemPromptExtra: '',
  }
}

describe('BudgetTracker', () => {
  let bus: MessageBus
  let tracker: BudgetTracker
  const SESSION = 'sess-1'
  const BUDGET = 10000

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test task')
    tracker = new BudgetTracker(bus, SESSION, [
      makeConfig('agent-a', BUDGET),
      makeConfig('agent-b', 5000),
    ])
  })

  afterEach(() => {
    bus.close()
  })

  it('returns ok at 0% usage (no updates yet)', () => {
    expect(tracker.getStatus('agent-a')).toBe('ok')
    expect(tracker.getUsageRatio('agent-a')).toBe(0)
  })

  it('returns ok below 80%', () => {
    tracker.update('agent-a', { input: 3000, output: 4000 }) // 70%
    expect(tracker.getStatus('agent-a')).toBe('ok')
  })

  it('returns warning at ≥80% and publishes checkpoint_request', () => {
    tracker.update('agent-a', { input: 4000, output: 4500 }) // 85%
    expect(tracker.getStatus('agent-a')).toBe('warning')
    const msgs = bus.getMessages(SESSION)
    const budgetMsg = msgs.find(m => m.type === 'checkpoint_request')
    expect(budgetMsg).toBeDefined()
    const payload = budgetMsg?.payload as Record<string, unknown>
    expect(payload['event']).toBe('budget_warning')
    expect(payload['status']).toBe('warning')
    expect(payload['agentId']).toBe('agent-a')
  })

  it('returns critical at ≥90%', () => {
    tracker.update('agent-a', { input: 5000, output: 4500 }) // 95%
    expect(tracker.getStatus('agent-a')).toBe('critical')
  })

  it('returns exceeded at ≥100%', () => {
    tracker.update('agent-a', { input: 6000, output: 5000 }) // 110%
    expect(tracker.getStatus('agent-a')).toBe('exceeded')
  })

  it('accumulates tokens across multiple update calls', () => {
    tracker.update('agent-a', { input: 2000, output: 2000 }) // 40% — ok
    expect(tracker.getStatus('agent-a')).toBe('ok')
    tracker.update('agent-a', { input: 2000, output: 2000 }) // 80% — warning
    expect(tracker.getStatus('agent-a')).toBe('warning')
  })

  it('returns correct usage ratio', () => {
    tracker.update('agent-a', { input: 1000, output: 1000 }) // 20%
    expect(tracker.getUsageRatio('agent-a')).toBeCloseTo(0.2)
  })

  it('returns correct total used', () => {
    tracker.update('agent-a', { input: 1500, output: 2500 })
    expect(tracker.getTotalUsed('agent-a')).toBe(4000)
  })

  it('returns ok and ratio 0 for unknown agent', () => {
    expect(tracker.getStatus('unknown')).toBe('ok')
    expect(tracker.getUsageRatio('unknown')).toBe(0)
    expect(tracker.getTotalUsed('unknown')).toBe(0)
  })

  it('tracks multiple agents independently', () => {
    tracker.update('agent-a', { input: 4000, output: 4500 }) // 85% of 10000
    tracker.update('agent-b', { input: 500, output: 500 })   // 20% of 5000
    expect(tracker.getStatus('agent-a')).toBe('warning')
    expect(tracker.getStatus('agent-b')).toBe('ok')
  })

  it('no checkpoint_request published when status is ok', () => {
    tracker.update('agent-a', { input: 1000, output: 2000 }) // 30%
    const msgs = bus.getMessages(SESSION)
    expect(msgs.some(m => m.type === 'checkpoint_request')).toBe(false)
  })

  it('checkpoint_request payload includes current ratio', () => {
    tracker.update('agent-a', { input: 4500, output: 4500 }) // 90%
    const msgs = bus.getMessages(SESSION)
    const budgetMsg = msgs.find(m => m.type === 'checkpoint_request')
    const payload = budgetMsg?.payload as Record<string, unknown>
    expect(typeof payload['ratio']).toBe('number')
    expect(payload['ratio'] as number).toBeCloseTo(0.9)
  })
})
