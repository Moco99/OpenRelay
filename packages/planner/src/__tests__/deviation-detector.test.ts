import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { DeviationDetector } from '../deviation-detector.js'
import type { IAgentAdapter, AgentChunk } from '@openrelay/adapters'
import type { AgentConfig, Task } from '@openrelay/core'

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

const testConfig: AgentConfig = {
  id: 'orchestrator',
  role: 'planner',
  mode: 'cli',
  cli: 'claude',
  model: 'claude-opus-4-5',
  tokenBudget: 50000,
  checkpoints: [],
  workingDir: '/tmp',
  env: {},
  systemPromptExtra: '',
}

describe('DeviationDetector', () => {
  let bus: MessageBus
  let task: Task
  const SESSION = 'sess-1'

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test task')
    task = bus.createTask({
      id: 'task-1',
      sessionId: SESSION,
      planId: 'plan-1',
      title: 'Implement auth',
      description: 'Create JWT middleware',
      successCriteria: 'All endpoints return 401 for unauthenticated requests',
      assignedTo: 'executor',
      planExpectation: 'JWT middleware created and tested',
    })
  })

  afterEach(() => {
    bus.close()
  })

  it('marks task done and returns passed=true when LLM agrees', async () => {
    const detector = new DeviationDetector(
      mockAdapter('{"passed":true,"reason":"Looks correct","severity":"minor"}'),
      bus, testConfig, SESSION,
    )
    const report = await detector.evaluate(task, 'JWT middleware implemented')
    expect(report.passed).toBe(true)
    expect(report.taskId).toBe('task-1')
    const tasks = bus.getTasks(SESSION)
    expect(tasks[0]?.status).toBe('done')
    expect(tasks[0]?.actualOutput).toBe('JWT middleware implemented')
    expect(tasks[0]?.deviationReport).toBeNull()
  })

  it('marks task failed and publishes deviation_detected when passed=false', async () => {
    const detector = new DeviationDetector(
      mockAdapter('{"passed":false,"reason":"Missing error handling","severity":"major"}'),
      bus, testConfig, SESSION,
    )
    const report = await detector.evaluate(task, 'incomplete output')
    expect(report.passed).toBe(false)
    expect(report.severity).toBe('major')
    expect(report.reason).toBe('Missing error handling')
    const tasks = bus.getTasks(SESSION)
    expect(tasks[0]?.status).toBe('failed')
    const msgs = bus.getMessages(SESSION)
    const devMsg = msgs.find(m => m.type === 'deviation_detected')
    expect(devMsg).toBeDefined()
    expect(devMsg?.fromAgent).toBe('orchestrator')
  })

  it('does not publish deviation_detected when passed=true', async () => {
    const detector = new DeviationDetector(
      mockAdapter('{"passed":true,"reason":"OK"}'),
      bus, testConfig, SESSION,
    )
    await detector.evaluate(task, 'output')
    const msgs = bus.getMessages(SESSION)
    expect(msgs.some(m => m.type === 'deviation_detected')).toBe(false)
  })

  it('stores deviationReport as JSON string in task when failed', async () => {
    const detector = new DeviationDetector(
      mockAdapter('{"passed":false,"reason":"Bad","severity":"critical","suggestion":"Add try/catch"}'),
      bus, testConfig, SESSION,
    )
    await detector.evaluate(task, 'output')
    const tasks = bus.getTasks(SESSION)
    expect(tasks[0]?.deviationReport).not.toBeNull()
    const parsed = JSON.parse(tasks[0]!.deviationReport!) as Record<string, unknown>
    expect(parsed['severity']).toBe('critical')
    expect(parsed['suggestion']).toBe('Add try/catch')
  })

  it('handles malformed JSON gracefully — returns passed=false, severity major', async () => {
    const detector = new DeviationDetector(
      mockAdapter('completely not json'),
      bus, testConfig, SESSION,
    )
    const report = await detector.evaluate(task, 'output')
    expect(report.passed).toBe(false)
    expect(report.severity).toBe('major')
    expect(report.reason).toContain('Failed to parse')
  })

  it('extracts JSON from prose response', async () => {
    const prose = 'After reviewing: {"passed":true,"reason":"Meets criteria"} great work!'
    const detector = new DeviationDetector(mockAdapter(prose), bus, testConfig, SESSION)
    const report = await detector.evaluate(task, 'output')
    expect(report.passed).toBe(true)
  })

  it('defaults unknown severity to major', async () => {
    const detector = new DeviationDetector(
      mockAdapter('{"passed":false,"reason":"Bad","severity":"catastrophic"}'),
      bus, testConfig, SESSION,
    )
    const report = await detector.evaluate(task, 'output')
    expect(report.severity).toBe('major')
  })

  it('rethrows on adapter error chunk', async () => {
    const errAdapter: IAgentAdapter = {
      async *send(): AsyncGenerator<AgentChunk> {
        yield { type: 'error', content: 'timeout' }
      },
      getTokensUsed: () => ({ input: 0, output: 0 }),
      terminate: async () => {},
    }
    const detector = new DeviationDetector(errAdapter, bus, testConfig, SESSION)
    await expect(detector.evaluate(task, 'output')).rejects.toThrow('Adapter error: timeout')
  })
})
