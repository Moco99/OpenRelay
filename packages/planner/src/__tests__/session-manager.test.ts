import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { SessionManager } from '../session-manager.js'
import type { IAgentAdapter, AgentChunk } from '@openrelay/adapters'
import type { ProjectConfig } from '@openrelay/core'

const validPlan = {
  tasks: [
    {
      id: 'task-1', order: 1, title: 'Write code',
      description: 'Implement the feature', successCriteria: 'Tests pass',
      assignedTo: 'executor', dependsOn: [], retryStrategy: 'none',
    },
  ],
}

function mockAdapter(response: string): IAgentAdapter {
  return {
    async *send(): AsyncGenerator<AgentChunk> {
      yield { type: 'text', content: response }
      yield { type: 'done', content: '' }
    },
    getTokensUsed: () => ({ input: 5, output: 20 }),
    terminate: async () => {},
  }
}

const testConfig: ProjectConfig = {
  agents: [
    {
      id: 'orchestrator', role: 'planner', mode: 'cli', cli: 'claude',
      model: 'claude-opus-4-5', tokenBudget: 50_000,
      checkpoints: ['plan_ready', 'deviation_found'],
      workingDir: '/tmp', env: {}, systemPromptExtra: '',
    },
    {
      id: 'executor', role: 'coder', mode: 'cli', cli: 'gemini',
      model: 'gemini-2.5-pro', tokenBudget: 200_000,
      checkpoints: [],
      workingDir: '/tmp', env: {}, systemPromptExtra: '',
    },
  ],
  session: {
    maxRetries: 2,
    summaryInterval: 10,
    checkpointTimeout: 300,
    workingDir: '/tmp',
  },
}

// Helper: publish checkpoint responses as they appear in the bus
function autoRespond(
  bus: MessageBus,
  sessionId: string,
  decision: string,
): () => void {
  let active = true
  let lastSeen = 0
  const loop = async () => {
    while (active) {
      await new Promise(r => setTimeout(r, 5))
      if (!active) break
      try {
        const msgs = bus.getMessages(sessionId, lastSeen)
        for (const msg of msgs) {
          if (msg.seq > lastSeen) lastSeen = msg.seq
          if (msg.type === 'checkpoint_request') {
            bus.publish({
              sessionId, fromAgent: 'human', toAgent: 'session',
              type: 'checkpoint_response',
              payload: { checkpointMessageId: msg.id, decision },
              tokensIn: 0, tokensOut: 0,
            })
          }
        }
      } catch { active = false }
    }
  }
  void loop()
  return () => { active = false }
}

describe('SessionManager', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
  })

  afterEach(() => { bus.close() })

  it('getSessionId returns a stable uuid before run()', () => {
    const manager = new SessionManager(bus, testConfig, mockAdapter(JSON.stringify(validPlan)))
    const id = manager.getSessionId()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(manager.getSessionId()).toBe(id)
  })

  it('creates session in bus with correct task', async () => {
    const planner = mockAdapter(JSON.stringify(validPlan))
    const manager = new SessionManager(bus, testConfig, planner, {
      checkpointPollMs: 10,
      executorAdapterFactory: () => mockAdapter('done'),
    })
    const sessionId = manager.getSessionId()
    const stop = autoRespond(bus, sessionId, 'approved')
    await manager.run('implement auth')
    stop()
    const session = bus.getSession(sessionId)
    expect(session?.originalTask).toBe('implement auth')
  })

  it('cancels session when plan is rejected', async () => {
    const planner = mockAdapter(JSON.stringify(validPlan))
    const manager = new SessionManager(bus, testConfig, planner, { checkpointPollMs: 10 })
    const sessionId = manager.getSessionId()
    const stop = autoRespond(bus, sessionId, 'rejected')
    await manager.run('test task')
    stop()
    const session = bus.getSession(sessionId)
    expect(session?.status).toBe('cancelled')
    const msgs = bus.getMessages(sessionId)
    const endMsg = msgs.find(m => m.type === 'session_end')
    expect((endMsg?.payload as Record<string, unknown>)['reason']).toBe('plan_rejected')
  })

  it('marks session completed after successful run', async () => {
    const planner = mockAdapter(JSON.stringify(validPlan))
    const deviationResponse = JSON.stringify({ passed: true, reason: 'ok', severity: 'minor' })
    let callCount = 0
    const multiAdapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> {
        callCount++
        // First call: plan generation; subsequent: deviation detection
        const response = callCount === 1 ? JSON.stringify(validPlan) : deviationResponse
        yield { type: 'text', content: response }
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 5, output: 20 }),
      terminate: async () => {},
    }
    const manager = new SessionManager(bus, testConfig, multiAdapter, {
      checkpointPollMs: 10,
      executorAdapterFactory: () => mockAdapter('feature implemented'),
    })
    const sessionId = manager.getSessionId()
    const stop = autoRespond(bus, sessionId, 'approved')
    await manager.run('implement feature')
    stop()
    const session = bus.getSession(sessionId)
    expect(session?.status).toBe('completed')
  })

  it('publishes session_end after completion', async () => {
    const deviationOk = JSON.stringify({ passed: true, reason: 'ok', severity: 'minor' })
    let callCount = 0
    const multiAdapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> {
        callCount++
        const response = callCount === 1 ? JSON.stringify(validPlan) : deviationOk
        yield { type: 'text', content: response }
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 5, output: 20 }),
      terminate: async () => {},
    }
    const manager = new SessionManager(bus, testConfig, multiAdapter, {
      checkpointPollMs: 10,
      executorAdapterFactory: () => mockAdapter('done'),
    })
    const sessionId = manager.getSessionId()
    const stop = autoRespond(bus, sessionId, 'approved')
    await manager.run('task')
    stop()
    const msgs = bus.getMessages(sessionId)
    expect(msgs.some(m => m.type === 'session_end')).toBe(true)
  })

  it('throws when no planner agent in config', async () => {
    const noPlanner: ProjectConfig = {
      ...testConfig,
      agents: testConfig.agents.filter(a => a.role !== 'planner'),
    }
    const manager = new SessionManager(bus, noPlanner, mockAdapter('{}'))
    await expect(manager.run('task')).rejects.toThrow('planner')
  })
})
