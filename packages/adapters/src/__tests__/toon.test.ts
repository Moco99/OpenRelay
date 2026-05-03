import { describe, it, expect } from 'bun:test'
import { decode } from '@toon-format/toon'
import { serializeWorkingMemory, serializeSessionSummary } from '../toon.js'
import type { Message, Task } from '@openrelay/core'

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg-1', seq: 1, sessionId: 's-1', fromAgent: 'orchestrator', toAgent: 'executor',
  type: 'task_assigned', payload: { text: 'do something' }, timestamp: 1000, tokensIn: 100, tokensOut: 0,
  ...overrides,
})

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't-1', sessionId: 's-1', planId: 'p-1', title: 'Write tests',
  description: 'Write unit tests', successCriteria: 'All tests pass',
  assignedTo: 'executor', status: 'pending', retries: 0,
  planExpectation: 'Test coverage', actualOutput: null, deviationReport: null,
  createdAt: 1000, updatedAt: 1000,
  ...overrides,
})

describe('serializeWorkingMemory', () => {
  it('returns a non-empty string', () => {
    const result = serializeWorkingMemory([makeMessage()], [makeTask()])
    expect(result.length).toBeGreaterThan(0)
  })

  it('contains message fields in output', () => {
    const result = serializeWorkingMemory([makeMessage()], [])
    expect(result).toContain('orchestrator')
    expect(result).toContain('task_assigned')
  })

  it('contains task fields in output', () => {
    const result = serializeWorkingMemory([], [makeTask()])
    expect(result).toContain('Write tests')
    expect(result).toContain('pending')
  })

  it('roundtrips through decode without losing structure', () => {
    const messages = [makeMessage({ seq: 1 }), makeMessage({ seq: 2, fromAgent: 'executor', type: 'task_result' })]
    const tasks = [makeTask({ id: 't-1', status: 'done' })]
    const encoded = serializeWorkingMemory(messages, tasks)
    const decoded = decode(encoded) as { messages: unknown[]; tasks: unknown[] }
    expect(decoded.messages).toHaveLength(2)
    expect(decoded.tasks).toHaveLength(1)
  })

  it('handles empty arrays without crashing', () => {
    expect(() => serializeWorkingMemory([], [])).not.toThrow()
    const result = serializeWorkingMemory([], [])
    expect(typeof result).toBe('string')
  })
})

describe('serializeSessionSummary', () => {
  it('returns a non-empty string', () => {
    const result = serializeSessionSummary('Completed 3 tasks successfully', 10)
    expect(result.length).toBeGreaterThan(0)
  })

  it('contains the summary content', () => {
    const result = serializeSessionSummary('Auth module implemented', 8)
    expect(result).toContain('Auth module implemented')
  })

  it('contains the messages_covered count', () => {
    const result = serializeSessionSummary('Summary text', 42)
    expect(result).toContain('42')
  })

  it('roundtrips through decode', () => {
    const encoded = serializeSessionSummary('Three tasks done', 15)
    const decoded = decode(encoded) as { session_summary: Array<{ content: string; messages_covered: number }> }
    expect(decoded.session_summary[0]!.content).toBe('Three tasks done')
    expect(decoded.session_summary[0]!.messages_covered).toBe(15)
  })
})
