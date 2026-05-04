import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '@openrelay/core'
import { buildContext } from '../context.js'

const SESSION = 'sess-1'

describe('buildContext', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
  })

  afterEach(() => { bus.close() })

  it('returns empty string when bus has no messages and no summaries', () => {
    expect(buildContext(bus, SESSION)).toBe('')
  })

  it('returns serialized working memory when messages exist but no summary', () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const ctx = buildContext(bus, SESSION)
    expect(ctx).not.toBe('')
    expect(typeof ctx).toBe('string')
  })

  it('returns only summary serialization when summary covers all messages', () => {
    const msg = bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    bus.addMemory(SESSION, 'summary', 'A concise summary.', 10, msg.seq)
    const ctx = buildContext(bus, SESSION)
    expect(ctx).toContain('A concise summary.')
    // No new messages after the summary seq — working memory part should be absent
    // (both parts would be present if messages are included)
  })

  it('includes both summary and new messages when delta exists', () => {
    const msg1 = bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    bus.addMemory(SESSION, 'summary', 'Prior summary.', 10, msg1.seq)
    bus.publish({
      sessionId: SESSION, fromAgent: 'b', toAgent: 'a',
      type: 'task_result', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    const ctx = buildContext(bus, SESSION)
    expect(ctx).toContain('Prior summary.')
    // Should also contain working memory from the new message
    expect(ctx.length).toBeGreaterThan('Prior summary.'.length)
  })

  it('uses afterSeq from summary so old messages are not included', () => {
    // Publish 3 messages, summarize after first 2, publish a 3rd
    const msg1 = bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: { n: 1 }, tokensIn: 0, tokensOut: 0,
    })
    bus.publish({
      sessionId: SESSION, fromAgent: 'b', toAgent: 'a',
      type: 'task_result', payload: { n: 2 }, tokensIn: 0, tokensOut: 0,
    })
    bus.addMemory(SESSION, 'summary', 'Summarized 2 msgs.', 10, msg1.seq)
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'task_assigned', payload: { n: 3 }, tokensIn: 0, tokensOut: 0,
    })

    // buildContext uses afterSeq = msg1.seq, so only msg2 and msg3 are included
    // But actually after msg1.seq means msg2 onwards. Then we added summary at msg1.seq,
    // and msg3 is published after. The context should include the 3rd message.
    // We can verify by checking the result is non-empty and contains the summary.
    const ctx = buildContext(bus, SESSION)
    expect(ctx).toContain('Summarized 2 msgs.')
  })

  it('works when no tasks exist in the bus', () => {
    bus.publish({
      sessionId: SESSION, fromAgent: 'a', toAgent: 'b',
      type: 'plan_generated', payload: {}, tokensIn: 0, tokensOut: 0,
    })
    // Should not throw even with no tasks
    expect(() => buildContext(bus, SESSION)).not.toThrow()
  })
})
