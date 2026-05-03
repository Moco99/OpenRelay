import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { CheckpointGate } from '../checkpoint-gate.js'

const SESSION = 'sess-1'

function publishResponse(bus: MessageBus, checkpointMessageId: string, decision: string) {
  bus.publish({
    sessionId: SESSION, fromAgent: 'human', toAgent: 'session',
    type: 'checkpoint_response',
    payload: { checkpointMessageId, decision },
    tokensIn: 0, tokensOut: 0,
  })
}

describe('CheckpointGate', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
  })

  afterEach(() => { bus.close() })

  it('auto-approves when timeout expires', async () => {
    const gate = new CheckpointGate(bus, SESSION, 10, 50)
    const decision = await gate.waitForResponse('cp-nonexistent')
    expect(decision).toBe('approved')
  })

  it('returns approved when matching response is published', async () => {
    const gate = new CheckpointGate(bus, SESSION, 10)
    setTimeout(() => publishResponse(bus, 'cp-1', 'approved'), 20)
    const decision = await gate.waitForResponse('cp-1', 500)
    expect(decision).toBe('approved')
  })

  it('returns rejected when matching response is published', async () => {
    const gate = new CheckpointGate(bus, SESSION, 10)
    setTimeout(() => publishResponse(bus, 'cp-2', 'rejected'), 20)
    const decision = await gate.waitForResponse('cp-2', 500)
    expect(decision).toBe('rejected')
  })

  it('returns skipped when matching response is published', async () => {
    const gate = new CheckpointGate(bus, SESSION, 10)
    setTimeout(() => publishResponse(bus, 'cp-3', 'skipped'), 20)
    const decision = await gate.waitForResponse('cp-3', 500)
    expect(decision).toBe('skipped')
  })

  it('ignores responses with wrong checkpointMessageId', async () => {
    const gate = new CheckpointGate(bus, SESSION, 10, 80)
    publishResponse(bus, 'cp-other', 'rejected')
    const decision = await gate.waitForResponse('cp-correct')
    // times out because 'cp-correct' never gets a response
    expect(decision).toBe('approved')
  })

  it('finds pre-published response on first poll', async () => {
    publishResponse(bus, 'cp-pre', 'skipped')
    const gate = new CheckpointGate(bus, SESSION, 200)
    const decision = await gate.waitForResponse('cp-pre', 5000)
    expect(decision).toBe('skipped')
  })
})
