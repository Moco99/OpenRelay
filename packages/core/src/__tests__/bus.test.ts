import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { rmSync } from 'fs'
import { MessageBus } from '../bus.js'

const TEST_DB = '/tmp/openrelay-test-bus.db'

describe('MessageBus', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(TEST_DB)
  })

  afterEach(() => {
    bus.close()
    for (const ext of ['', '-shm', '-wal']) {
      try { rmSync(TEST_DB + ext) } catch {}
    }
  })

  describe('publish + getMessages', () => {
    it('publishes a message and retrieves it', () => {
      const msg = bus.publish({
        sessionId: 'session-1',
        fromAgent: 'orchestrator',
        toAgent: 'executor',
        type: 'task_assigned',
        payload: { task: 'write tests' },
        tokensIn: 100,
        tokensOut: 50,
      })

      expect(msg.id).toBeTruthy()
      expect(msg.timestamp).toBeGreaterThan(0)

      const messages = bus.getMessages('session-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]!.fromAgent).toBe('orchestrator')
      expect(messages[0]!.payload).toEqual({ task: 'write tests' })
      expect(messages[0]!.tokensIn).toBe(100)
      expect(messages[0]!.tokensOut).toBe(50)
    })

    it('filters messages by sessionId', () => {
      bus.publish({ sessionId: 'session-1', fromAgent: 'a', toAgent: 'b', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })
      bus.publish({ sessionId: 'session-2', fromAgent: 'a', toAgent: 'b', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })

      expect(bus.getMessages('session-1')).toHaveLength(1)
      expect(bus.getMessages('session-2')).toHaveLength(1)
      expect(bus.getMessages('session-3')).toHaveLength(0)
    })

    it('filters messages by afterSeq (exclusive, using SQLite rowid)', () => {
      const m1 = bus.publish({ sessionId: 's-1', fromAgent: 'a', toAgent: 'b', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })
      bus.publish({ sessionId: 's-1', fromAgent: 'a', toAgent: 'b', type: 'task_result', payload: {}, tokensIn: 0, tokensOut: 0 })

      const after = bus.getMessages('s-1', m1.seq)
      expect(after).toHaveLength(1)
      expect(after[0]!.type).toBe('task_result')
    })

    it('returns messages in ascending timestamp order', () => {
      bus.publish({ sessionId: 's-1', fromAgent: 'a', toAgent: 'b', type: 'plan_generated', payload: {}, tokensIn: 0, tokensOut: 0 })
      bus.publish({ sessionId: 's-1', fromAgent: 'b', toAgent: 'a', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })
      bus.publish({ sessionId: 's-1', fromAgent: 'a', toAgent: 'b', type: 'task_result', payload: {}, tokensIn: 0, tokensOut: 0 })

      const messages = bus.getMessages('s-1')
      expect(messages[0]!.type).toBe('plan_generated')
      expect(messages[1]!.type).toBe('task_assigned')
      expect(messages[2]!.type).toBe('task_result')
    })
  })

  describe('sessions', () => {
    it('creates and retrieves a session', () => {
      const session = bus.createSession('s-1', '/my/project', 'build authentication')

      expect(session.id).toBe('s-1')
      expect(session.status).toBe('active')
      expect(session.endedAt).toBeNull()
      expect(session.summary).toBeNull()

      const retrieved = bus.getSession('s-1')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.originalTask).toBe('build authentication')
      expect(retrieved!.projectDir).toBe('/my/project')
    })

    it('returns null for non-existent session', () => {
      expect(bus.getSession('does-not-exist')).toBeNull()
    })

    it('updates session status and endedAt', () => {
      bus.createSession('s-2', '/proj', 'task')
      const endTime = Date.now()
      bus.updateSession('s-2', { status: 'completed', endedAt: endTime })

      const session = bus.getSession('s-2')
      expect(session!.status).toBe('completed')
      expect(session!.endedAt).toBe(endTime)
    })

    it('updates session summary', () => {
      bus.createSession('s-3', '/proj', 'task')
      bus.updateSession('s-3', { summary: 'Completed 3 tasks successfully' })

      const session = bus.getSession('s-3')
      expect(session!.summary).toBe('Completed 3 tasks successfully')
    })
  })

  describe('agent state', () => {
    it('inserts agent state on first upsert', () => {
      bus.upsertAgentState('s-1', 'orchestrator', { status: 'working', tokensIn: 500, tokensOut: 200, costUsd: 0.01 })

      const state = bus.getAgentState('s-1', 'orchestrator')
      expect(state).not.toBeNull()
      expect(state!.status).toBe('working')
      expect(state!.tokensIn).toBe(500)
      expect(state!.tokensOut).toBe(200)
      expect(state!.costUsd).toBeCloseTo(0.01)
    })

    it('accumulates tokens on successive upserts', () => {
      bus.upsertAgentState('s-1', 'orchestrator', { tokensIn: 100, tokensOut: 50, costUsd: 0.001 })
      bus.upsertAgentState('s-1', 'orchestrator', { tokensIn: 200, tokensOut: 100, costUsd: 0.002 })

      const state = bus.getAgentState('s-1', 'orchestrator')
      expect(state!.tokensIn).toBe(300)
      expect(state!.tokensOut).toBe(150)
      expect(state!.costUsd).toBeCloseTo(0.003)
    })

    it('returns null for non-existent agent state', () => {
      expect(bus.getAgentState('s-1', 'ghost')).toBeNull()
    })
  })

  describe('tasks', () => {
    it('creates a task with defaults', () => {
      const task = bus.createTask({
        id: 't-1',
        sessionId: 's-1',
        planId: 'p-1',
        title: 'Write unit tests',
        description: 'Write unit tests for the bus module',
        successCriteria: 'All 9 tests pass',
        assignedTo: 'executor',
        planExpectation: 'Tests cover all MessageBus methods',
      })

      expect(task.status).toBe('pending')
      expect(task.retries).toBe(0)
      expect(task.actualOutput).toBeNull()
      expect(task.deviationReport).toBeNull()
    })

    it('retrieves tasks for a session in creation order', () => {
      bus.createTask({ id: 't-1', sessionId: 's-1', planId: 'p-1', title: 'T1', description: 'D', successCriteria: 'S', assignedTo: 'executor', planExpectation: 'P' })
      bus.createTask({ id: 't-2', sessionId: 's-1', planId: 'p-1', title: 'T2', description: 'D', successCriteria: 'S', assignedTo: 'executor', planExpectation: 'P' })

      const tasks = bus.getTasks('s-1')
      expect(tasks).toHaveLength(2)
      expect(tasks[0]!.title).toBe('T1')
      expect(tasks[1]!.title).toBe('T2')
    })

    it('updates task status and actual output', () => {
      bus.createTask({ id: 't-1', sessionId: 's-1', planId: 'p-1', title: 'T', description: 'D', successCriteria: 'S', assignedTo: 'executor', planExpectation: 'P' })
      bus.updateTask('t-1', { status: 'done', actualOutput: 'tests written and passing' })

      const task = bus.getTasks('s-1')[0]!
      expect(task.status).toBe('done')
      expect(task.actualOutput).toBe('tests written and passing')
    })

    it('increments retries', () => {
      bus.createTask({ id: 't-1', sessionId: 's-1', planId: 'p-1', title: 'T', description: 'D', successCriteria: 'S', assignedTo: 'executor', planExpectation: 'P' })
      bus.updateTask('t-1', { status: 'failed', retries: 1 })
      bus.updateTask('t-1', { status: 'failed', retries: 2 })

      const task = bus.getTasks('s-1')[0]!
      expect(task.retries).toBe(2)
    })

    it('stores deviation report as string', () => {
      bus.createTask({ id: 't-1', sessionId: 's-1', planId: 'p-1', title: 'T', description: 'D', successCriteria: 'S', assignedTo: 'executor', planExpectation: 'P' })
      const report = JSON.stringify({ passed: false, reason: 'Missing error handling', severity: 'major' })
      bus.updateTask('t-1', { deviationReport: report })

      const task = bus.getTasks('s-1')[0]!
      expect(JSON.parse(task.deviationReport!)).toEqual({ passed: false, reason: 'Missing error handling', severity: 'major' })
    })
  })
})
