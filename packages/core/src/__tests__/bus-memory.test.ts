import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { MessageBus } from '../bus.js'

const SESSION = 'sess-1'

describe('MessageBus memory methods', () => {
  let bus: MessageBus

  beforeEach(() => {
    bus = new MessageBus(':memory:')
    bus.createSession(SESSION, '/project', 'test')
  })

  afterEach(() => { bus.close() })

  it('addMemory returns a SessionMemory with correct fields', () => {
    const mem = bus.addMemory(SESSION, 'summary', 'Session went well.', 50, 10)
    expect(mem.sessionId).toBe(SESSION)
    expect(mem.type).toBe('summary')
    expect(mem.content).toBe('Session went well.')
    expect(mem.tokens).toBe(50)
    expect(mem.coveredUpToSeq).toBe(10)
    expect(mem.id).toBeTruthy()
    expect(mem.createdAt).toBeGreaterThan(0)
  })

  it('addMemory defaults coveredUpToSeq to 0', () => {
    const mem = bus.addMemory(SESSION, 'working', 'some content', 20)
    expect(mem.coveredUpToSeq).toBe(0)
  })

  it('getMemories returns all memories for session', () => {
    bus.addMemory(SESSION, 'summary', 'first', 10, 5)
    bus.addMemory(SESSION, 'summary', 'second', 20, 10)
    const mems = bus.getMemories(SESSION)
    expect(mems).toHaveLength(2)
  })

  it('getMemories filters by type', () => {
    bus.addMemory(SESSION, 'summary', 'a summary', 10, 5)
    bus.addMemory(SESSION, 'working', 'working mem', 5)
    expect(bus.getMemories(SESSION, 'summary')).toHaveLength(1)
    expect(bus.getMemories(SESSION, 'working')).toHaveLength(1)
  })

  it('getLatestSummary returns null when no summaries exist', () => {
    expect(bus.getLatestSummary(SESSION)).toBeNull()
  })

  it('getLatestSummary returns the most recently added summary', () => {
    bus.addMemory(SESSION, 'summary', 'older', 10, 5)
    bus.addMemory(SESSION, 'summary', 'newer', 20, 15)
    const latest = bus.getLatestSummary(SESSION)
    expect(latest?.content).toBe('newer')
    expect(latest?.coveredUpToSeq).toBe(15)
  })

  it('getLatestSummary ignores non-summary entries', () => {
    bus.addMemory(SESSION, 'working', 'not a summary', 10)
    expect(bus.getLatestSummary(SESSION)).toBeNull()
  })

  it('getMemories returns empty array for unknown session', () => {
    expect(bus.getMemories('unknown-session')).toHaveLength(0)
  })
})
