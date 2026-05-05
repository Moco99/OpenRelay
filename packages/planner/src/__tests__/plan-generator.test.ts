import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { PlanGenerator } from '../plan-generator.js'
import type { IAgentAdapter, AgentChunk } from '@openrelay/adapters'
import type { AgentConfig } from '@openrelay/core'

function mockAdapter(response: string, tokensIn = 10, tokensOut = 50): IAgentAdapter {
  const usage = { input: 0, output: 0 }
  return {
    async *send(_prompt: string): AsyncGenerator<AgentChunk> {
      usage.input += tokensIn
      yield { type: 'text', content: response }
      usage.output += tokensOut
      yield { type: 'done', content: '' }
    },
    getTokensUsed: () => ({ ...usage }),
    terminate: async () => {},
  }
}

const testConfig: AgentConfig = {
  id: 'orchestrator',
  role: 'planner',
  mode: 'cli',
  cli: 'claude',
  model: 'claude-opus-4-5',
  tokenBudget: 50000,
  checkpoints: ['plan_ready'],
  workingDir: '/tmp',
  env: {},
  systemPromptExtra: '',
}

const validPlan = {
  tasks: [
    {
      id: 'task-1',
      order: 1,
      title: 'Implement auth',
      description: 'Create JWT auth middleware',
      successCriteria: 'All auth endpoints return 401 for unauthenticated requests',
      assignedTo: 'executor',
      dependsOn: [],
      retryStrategy: 'resubmit',
    },
    {
      id: 'task-2',
      order: 2,
      title: 'Add tests',
      description: 'Write integration tests',
      successCriteria: 'All tests pass',
      assignedTo: 'executor',
      dependsOn: ['task-1'],
      retryStrategy: 'none',
    },
  ],
}

describe('PlanGenerator', () => {
  let bus: MessageBus
  const SESSION = 'sess-1'

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test task')
  })

  afterEach(() => {
    bus.close()
  })

  it('parses valid JSON and returns a Plan with correct fields', async () => {
    const gen = new PlanGenerator(mockAdapter(JSON.stringify(validPlan)), bus, testConfig, SESSION)
    const plan = await gen.generate('implement auth module')
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]?.title).toBe('Implement auth')
    expect(plan.tasks[1]?.dependsOn).toEqual(['task-1'])
    expect(plan.sessionId).toBe(SESSION)
    expect(plan.originalTask).toBe('implement auth module')
  })

  it('creates one Task record in bus per plan task', async () => {
    const gen = new PlanGenerator(mockAdapter(JSON.stringify(validPlan)), bus, testConfig, SESSION)
    await gen.generate('implement auth')
    const tasks = bus.getTasks(SESSION)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.title).toBe('Implement auth')
    expect(tasks[0]?.status).toBe('pending')
    expect(tasks[1]?.successCriteria).toBe('All tests pass')
  })

  it('publishes a plan_generated message to bus', async () => {
    const gen = new PlanGenerator(mockAdapter(JSON.stringify(validPlan)), bus, testConfig, SESSION)
    await gen.generate('task')
    const msgs = bus.getMessages(SESSION)
    const planMsg = msgs.find(m => m.type === 'plan_generated')
    expect(planMsg).toBeDefined()
    expect(planMsg?.fromAgent).toBe('orchestrator')
    expect(planMsg?.tokensIn).toBe(10)
    expect(planMsg?.tokensOut).toBe(50)
  })

  it('strips markdown code fences before parsing', async () => {
    const wrapped = '```json\n' + JSON.stringify(validPlan) + '\n```'
    const gen = new PlanGenerator(mockAdapter(wrapped), bus, testConfig, SESSION)
    const plan = await gen.generate('task')
    expect(plan.tasks).toHaveLength(2)
  })

  it('handles plain JSON without fences', async () => {
    const gen = new PlanGenerator(mockAdapter(JSON.stringify(validPlan)), bus, testConfig, SESSION)
    const plan = await gen.generate('task')
    expect(plan.tasks).toHaveLength(2)
  })

  it('extracts JSON embedded in prose', async () => {
    const prose = 'Here is the plan: ' + JSON.stringify(validPlan) + ' Hope that helps!'
    const gen = new PlanGenerator(mockAdapter(prose), bus, testConfig, SESSION)
    const plan = await gen.generate('task')
    expect(plan.tasks).toHaveLength(2)
  })

  it('throws on completely invalid JSON', async () => {
    const gen = new PlanGenerator(mockAdapter('not json at all'), bus, testConfig, SESSION)
    await expect(gen.generate('task')).rejects.toThrow()
  })

  it('throws when tasks array is empty', async () => {
    const gen = new PlanGenerator(mockAdapter('{"tasks":[]}'), bus, testConfig, SESSION)
    await expect(gen.generate('task')).rejects.toThrow('at least one task')
  })

  it('injects working memory into the prompt when messages exist', async () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'user', toAgent: 'orchestrator',
      type: 'task_assigned', payload: 'some prior context', tokensIn: 0, tokensOut: 0,
    })

    let capturedPrompt = ''
    const capturingAdapter: IAgentAdapter = {
      async *send(prompt: string): AsyncGenerator<AgentChunk> {
        capturedPrompt = prompt
        yield { type: 'text', content: JSON.stringify(validPlan) }
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }

    const gen = new PlanGenerator(capturingAdapter, bus, testConfig, SESSION)
    await gen.generate('task')
    expect(capturedPrompt).toContain('Context from this session')
  })

  it('does not inject working memory when session is empty', async () => {
    let capturedPrompt = ''
    const capturingAdapter: IAgentAdapter = {
      async *send(prompt: string): AsyncGenerator<AgentChunk> {
        capturedPrompt = prompt
        yield { type: 'text', content: JSON.stringify(validPlan) }
        yield { type: 'done', content: '' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }

    const gen = new PlanGenerator(capturingAdapter, bus, testConfig, SESSION)
    await gen.generate('task')
    expect(capturedPrompt).not.toContain('Context from this session')
  })

  it('rethrows on adapter error chunk', async () => {
    const errAdapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> {
        yield { type: 'error', content: 'connection refused' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }
    const gen = new PlanGenerator(errAdapter, bus, testConfig, SESSION)
    await expect(gen.generate('task')).rejects.toThrow('Adapter error: connection refused')
  })
})
