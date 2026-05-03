import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import {
  fetchNewMessages,
  findNextCheckpoint,
  parseCheckpoint,
  publishCheckpointResponse,
} from '../poll.js'
import type { Message } from '@openrelay/core'

const SESSION = 'sess-1'

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1', seq: 1, sessionId: SESSION,
    fromAgent: 'orchestrator', toAgent: 'executor',
    type: 'task_assigned', payload: {},
    timestamp: Date.now(), tokensIn: 0, tokensOut: 0,
    ...overrides,
  }
}

describe('fetchNewMessages', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
  })

  afterEach(() => { bus.close() })

  it('returns empty array when bus is empty', () => {
    expect(fetchNewMessages(bus, SESSION, 0)).toHaveLength(0)
  })

  it('returns all messages from seq 0', () => {
    bus.publish({ sessionId: SESSION, fromAgent: 'a', toAgent: 'b', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })
    bus.publish({ sessionId: SESSION, fromAgent: 'b', toAgent: 'a', type: 'task_result',   payload: {}, tokensIn: 0, tokensOut: 0 })
    expect(fetchNewMessages(bus, SESSION, 0)).toHaveLength(2)
  })

  it('returns only messages strictly after afterSeq', () => {
    const m1 = bus.publish({ sessionId: SESSION, fromAgent: 'a', toAgent: 'b', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })
    bus.publish({ sessionId: SESSION, fromAgent: 'b', toAgent: 'a', type: 'task_result', payload: {}, tokensIn: 0, tokensOut: 0 })
    const msgs = fetchNewMessages(bus, SESSION, m1.seq)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.type).toBe('task_result')
  })

  it('returns empty when afterSeq is the latest', () => {
    const m = bus.publish({ sessionId: SESSION, fromAgent: 'a', toAgent: 'b', type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0 })
    expect(fetchNewMessages(bus, SESSION, m.seq)).toHaveLength(0)
  })
})

describe('findNextCheckpoint', () => {
  it('returns undefined for empty array', () => {
    expect(findNextCheckpoint([], new Set())).toBeUndefined()
  })

  it('returns undefined when no checkpoint_request messages', () => {
    const msgs = [makeMsg({ type: 'task_assigned' }), makeMsg({ id: '2', type: 'task_result' })]
    expect(findNextCheckpoint(msgs, new Set())).toBeUndefined()
  })

  it('returns first checkpoint_request message', () => {
    const msgs = [
      makeMsg({ id: 'cp-1', type: 'checkpoint_request' }),
      makeMsg({ id: 'cp-2', type: 'checkpoint_request' }),
    ]
    expect(findNextCheckpoint(msgs, new Set())?.id).toBe('cp-1')
  })

  it('skips already-handled message ids', () => {
    const msgs = [
      makeMsg({ id: 'cp-1', type: 'checkpoint_request' }),
      makeMsg({ id: 'cp-2', type: 'checkpoint_request' }),
    ]
    expect(findNextCheckpoint(msgs, new Set(['cp-1']))?.id).toBe('cp-2')
  })

  it('returns undefined when all checkpoints handled', () => {
    const msgs = [makeMsg({ id: 'cp-1', type: 'checkpoint_request' })]
    expect(findNextCheckpoint(msgs, new Set(['cp-1']))).toBeUndefined()
  })
})

describe('parseCheckpoint', () => {
  it('extracts event and agentId from payload', () => {
    const msg = makeMsg({
      id: 'cp-1',
      type: 'checkpoint_request',
      payload: { event: 'budget_warning', agentId: 'executor', ratio: 0.85 },
    })
    const cp = parseCheckpoint(msg)
    expect(cp.messageId).toBe('cp-1')
    expect(cp.event).toBe('budget_warning')
    expect(cp.agentId).toBe('executor')
    expect((cp.payload as Record<string, unknown>)['ratio']).toBe(0.85)
  })

  it('falls back to fromAgent when payload has no agentId', () => {
    const msg = makeMsg({
      id: 'cp-2', fromAgent: 'orchestrator',
      type: 'checkpoint_request',
      payload: { event: 'plan_ready' },
    })
    expect(parseCheckpoint(msg).agentId).toBe('orchestrator')
  })

  it('defaults event to "checkpoint" when missing from payload', () => {
    const msg = makeMsg({ type: 'checkpoint_request', payload: {} })
    expect(parseCheckpoint(msg).event).toBe('checkpoint')
  })
})

describe('publishCheckpointResponse', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
  })

  afterEach(() => { bus.close() })

  it('publishes a checkpoint_response message', () => {
    const cp = { messageId: 'cp-1', event: 'plan_ready', agentId: 'orchestrator', payload: {} }
    publishCheckpointResponse(bus, SESSION, cp, 'approved')

    const msgs = bus.getMessages(SESSION)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.type).toBe('checkpoint_response')
    expect(msgs[0]?.fromAgent).toBe('human')
    expect(msgs[0]?.toAgent).toBe('orchestrator')
  })

  it('includes decision and checkpointMessageId in payload', () => {
    const cp = { messageId: 'cp-1', event: 'plan_ready', agentId: 'orchestrator', payload: {} }
    publishCheckpointResponse(bus, SESSION, cp, 'approved')

    const payload = bus.getMessages(SESSION)[0]?.payload as Record<string, unknown>
    expect(payload['decision']).toBe('approved')
    expect(payload['checkpointMessageId']).toBe('cp-1')
  })

  it('includes optional feedback when provided', () => {
    const cp = { messageId: 'cp-1', event: 'plan_ready', agentId: 'orch', payload: {} }
    publishCheckpointResponse(bus, SESSION, cp, 'rejected', 'Add step for tests')

    const payload = bus.getMessages(SESSION)[0]?.payload as Record<string, unknown>
    expect(payload['feedback']).toBe('Add step for tests')
    expect(payload['decision']).toBe('rejected')
  })

  it('works with all decision types', () => {
    const cp = { messageId: 'cp-1', event: 'plan_ready', agentId: 'orch', payload: {} }
    for (const decision of ['approved', 'rejected', 'skipped'] as const) {
      publishCheckpointResponse(bus, SESSION, cp, decision)
    }
    expect(bus.getMessages(SESSION)).toHaveLength(3)
  })
})
