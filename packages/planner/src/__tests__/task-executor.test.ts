import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { TaskExecutor } from '../task-executor.js'
import { BudgetTracker } from '../budget-tracker.js'
import type { IAgentAdapter, AgentChunk, TokenUsage } from '@openrelay/adapters'
import type { Task, AgentConfig } from '@openrelay/core'

const SESSION = 'sess-1'

function mockAdapter(response: string, tokensIn = 10, tokensOut = 50): IAgentAdapter {
  return {
    async *send(): AsyncGenerator<AgentChunk> {
      yield { type: 'text', content: response }
      yield { type: 'done', content: '' }
    },
    getTokensUsed: () => ({ input: tokensIn, output: tokensOut }),
    terminate: async () => {},
  }
}

function errorAdapter(msg: string): IAgentAdapter {
  return {
    async *send(): AsyncGenerator<AgentChunk> {
      yield { type: 'error', content: msg }
    },
    getTokensUsed: () => ({ input: 0, output: 0 }),
    terminate: async () => {},
  }
}

const executorAgentConfig: AgentConfig = {
  id: 'executor', role: 'coder', mode: 'cli', cli: 'gemini',
  model: 'gemini-2.5-pro', tokenBudget: 200_000, checkpoints: [],
  workingDir: '/tmp', env: {}, systemPromptExtra: '',
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', sessionId: SESSION, planId: 'plan-1',
    title: 'Implement feature', description: 'Write the code',
    successCriteria: 'Tests pass', assignedTo: 'executor',
    status: 'pending', retries: 0, planExpectation: 'Tests pass',
    actualOutput: null, deviationReport: null,
    createdAt: Date.now(), updatedAt: Date.now(),
    ...overrides,
  }
}

describe('TaskExecutor', () => {
  let bus: MessageBus
  let budgetTracker: BudgetTracker

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
    bus.createTask({
      id: 'task-1', sessionId: SESSION, planId: 'plan-1',
      title: 'Implement feature', description: 'Write the code',
      successCriteria: 'Tests pass', assignedTo: 'executor',
      planExpectation: 'Tests pass',
    })
    budgetTracker = new BudgetTracker(bus, SESSION, [executorAgentConfig])
  })

  afterEach(() => { bus.close() })

  it('returns the output from adapter', async () => {
    const executor = new TaskExecutor(
      () => mockAdapter('Done!'), bus, SESSION, 'executor', budgetTracker,
    )
    const output = await executor.execute(makeTask())
    expect(output).toBe('Done!')
  })

  it('sets task status to in_progress during execution', async () => {
    let statusDuringExec = ''
    const adapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> {
        const tasks = bus.getTasks(SESSION)
        statusDuringExec = tasks[0]?.status ?? ''
        yield { type: 'text', content: 'ok' }
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }
    const executor = new TaskExecutor(
      () => adapter, bus, SESSION, 'executor', budgetTracker,
    )
    await executor.execute(makeTask())
    expect(statusDuringExec).toBe('in_progress')
  })

  it('publishes task_assigned and task_result messages', async () => {
    const executor = new TaskExecutor(
      () => mockAdapter('output'), bus, SESSION, 'executor', budgetTracker,
    )
    await executor.execute(makeTask())
    const msgs = bus.getMessages(SESSION)
    expect(msgs.some(m => m.type === 'task_assigned')).toBe(true)
    expect(msgs.some(m => m.type === 'task_result')).toBe(true)
  })

  it('sets agent state to working then idle', async () => {
    let statusDuring = ''
    const adapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> {
        const state = bus.getAgentState(SESSION, 'executor')
        statusDuring = state?.status ?? ''
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }
    const executor = new TaskExecutor(
      () => adapter, bus, SESSION, 'executor', budgetTracker,
    )
    await executor.execute(makeTask())
    expect(statusDuring).toBe('working')
    const state = bus.getAgentState(SESSION, 'executor')
    expect(state?.status).toBe('idle')
  })

  it('calls budgetTracker with adapter usage', async () => {
    const captured: TokenUsage[] = []
    const tracker = {
      update: (_id: string, u: TokenUsage) => { captured.push(u) },
    } as unknown as BudgetTracker

    const executor = new TaskExecutor(
      () => mockAdapter('ok', 5, 20), bus, SESSION, 'executor', tracker,
    )
    await executor.execute(makeTask())
    expect(captured).toHaveLength(1)
    expect(captured[0]?.input).toBe(5)
    expect(captured[0]?.output).toBe(20)
  })

  it('includes tokensIn and tokensOut in task_result message', async () => {
    const executor = new TaskExecutor(
      () => mockAdapter('ok', 10, 50), bus, SESSION, 'executor', budgetTracker,
    )
    await executor.execute(makeTask())
    const msg = bus.getMessages(SESSION).find(m => m.type === 'task_result')
    expect(msg?.tokensIn).toBe(10)
    expect(msg?.tokensOut).toBe(50)
  })

  it('sets task to failed and throws on adapter error', async () => {
    const executor = new TaskExecutor(
      () => errorAdapter('timeout'), bus, SESSION, 'executor', budgetTracker,
    )
    await expect(executor.execute(makeTask())).rejects.toThrow('Executor error: timeout')
    const tasks = bus.getTasks(SESSION)
    expect(tasks[0]?.status).toBe('failed')
  })

  it('sets agent state to error on adapter error', async () => {
    const executor = new TaskExecutor(
      () => errorAdapter('fail'), bus, SESSION, 'executor', budgetTracker,
    )
    await executor.execute(makeTask()).catch(() => {})
    const state = bus.getAgentState(SESSION, 'executor')
    expect(state?.status).toBe('error')
  })

  it('prompt includes title, description, and successCriteria', async () => {
    let capturedPrompt = ''
    const adapter: IAgentAdapter = {
      async *send(prompt: string): AsyncGenerator<AgentChunk> {
        capturedPrompt = prompt
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }
    const executor = new TaskExecutor(
      () => adapter, bus, SESSION, 'executor', budgetTracker,
    )
    const task = makeTask({ title: 'Build auth', description: 'Create JWT middleware', successCriteria: '401 for unauthenticated' })
    await executor.execute(task)
    expect(capturedPrompt).toContain('Build auth')
    expect(capturedPrompt).toContain('Create JWT middleware')
    expect(capturedPrompt).toContain('401 for unauthenticated')
  })

  it('creates a fresh adapter per execute call via factory', async () => {
    let factoryCallCount = 0
    const factory = () => {
      factoryCallCount++
      return mockAdapter('ok')
    }
    const executor = new TaskExecutor(factory, bus, SESSION, 'executor', budgetTracker)
    await executor.execute(makeTask())
    await executor.execute(makeTask())
    expect(factoryCallCount).toBe(2)
  })
})
