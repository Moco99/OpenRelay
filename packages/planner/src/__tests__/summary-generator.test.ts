import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { SummaryGenerator } from '../summary-generator.js'
import type { IAgentAdapter, AgentChunk } from '@openrelay/adapters'
import type { AgentConfig } from '@openrelay/core'

const SESSION = 'sess-1'

function mockAdapter(response: string): IAgentAdapter {
  const usage = { input: 0, output: 0 }
  return {
    async *send(): AsyncGenerator<AgentChunk> {
      usage.input += 5
      yield { type: 'text', content: response }
      usage.output += 20
      yield { type: 'done', content: '' }
    },
    getTokensUsed: () => ({ ...usage }),
    terminate: async () => {},
  }
}

function errorAdapter(): IAgentAdapter {
  return {
    async *send(): AsyncGenerator<AgentChunk> {
      yield { type: 'error', content: 'timeout' }
    },
    getTokensUsed: () => ({ input: 0, output: 0 }),
    terminate: async () => {},
  }
}

const plannerConfig: AgentConfig = {
  id: 'orchestrator', role: 'planner', mode: 'cli', cli: 'claude',
  model: 'claude-opus-4-5', tokenBudget: 50_000,
  checkpoints: ['plan_ready'], workingDir: '/tmp', env: {}, systemPromptExtra: '',
}

describe('SummaryGenerator', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
  })

  afterEach(() => { bus.close() })

  it('returns null when no messages in bus', async () => {
    const gen = new SummaryGenerator(mockAdapter('summary text'), bus, plannerConfig, SESSION)
    expect(await gen.summarize()).toBeNull()
  })

  it('returns null when all messages already covered by existing summary', async () => {
    const msg = bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    bus.addMemory(SESSION, 'summary', 'existing summary', 10, msg.seq)
    const gen = new SummaryGenerator(mockAdapter('new summary'), bus, plannerConfig, SESSION)
    expect(await gen.summarize()).toBeNull()
  })

  it('returns null when adapter yields empty response', async () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const emptyAdapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> { yield { type: 'done', content: '' } },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }
    const gen = new SummaryGenerator(emptyAdapter, bus, plannerConfig, SESSION)
    expect(await gen.summarize()).toBeNull()
  })

  it('returns null when adapter errors (non-fatal)', async () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const gen = new SummaryGenerator(errorAdapter(), bus, plannerConfig, SESSION)
    expect(await gen.summarize()).toBeNull()
  })

  it('generates and stores summary covering all current messages', async () => {
    const msg = bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const gen = new SummaryGenerator(mockAdapter('• Auth implemented\n• Tests pass'), bus, plannerConfig, SESSION)
    const result = await gen.summarize()

    expect(result).not.toBeNull()
    expect(result?.content).toBe('• Auth implemented\n• Tests pass')
    expect(result?.coveredUpToSeq).toBe(msg.seq)
    expect(result?.type).toBe('summary')
  })

  it('stores summary in bus and it becomes the latest summary', async () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const gen = new SummaryGenerator(mockAdapter('Summary text'), bus, plannerConfig, SESSION)
    await gen.summarize()

    const latest = bus.getLatestSummary(SESSION)
    expect(latest?.content).toBe('Summary text')
  })

  it('publishes memory_update message to bus', async () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const gen = new SummaryGenerator(mockAdapter('summary'), bus, plannerConfig, SESSION)
    await gen.summarize()

    const msgs = bus.getMessages(SESSION)
    expect(msgs.some(m => m.type === 'memory_update')).toBe(true)
  })
})
