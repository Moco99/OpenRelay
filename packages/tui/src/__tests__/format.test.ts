import { describe, it, expect } from 'bun:test'
import { formatTime, formatDuration, formatMessage, formatBudgetBar } from '../format.js'
import type { Message } from '@openrelay/core'

describe('formatTime', () => {
  it('produces HH:MM:SS format', () => {
    expect(formatTime(Date.now())).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

describe('formatDuration', () => {
  it('shows seconds for < 1 minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(59_999)).toBe('59s')
  })

  it('shows minutes and seconds for < 1 hour', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(3599_000)).toBe('59m 59s')
  })

  it('shows hours and minutes for >= 1 hour', () => {
    expect(formatDuration(3600_000)).toBe('1h 0m')
    expect(formatDuration(7_320_000)).toBe('2h 2m')
  })
})

describe('formatBudgetBar', () => {
  it('empty at 0%', () => {
    expect(formatBudgetBar(0, 10)).toBe('░░░░░░░░░░')
  })

  it('half at 50%', () => {
    expect(formatBudgetBar(0.5, 10)).toBe('█████░░░░░')
  })

  it('full at 100%', () => {
    expect(formatBudgetBar(1.0, 10)).toBe('██████████')
  })

  it('clamps to width when ratio > 1', () => {
    const bar = formatBudgetBar(2.0, 10)
    expect(bar).toBe('██████████')
    expect(bar.length).toBe(10)
  })

  it('total length equals width', () => {
    for (const ratio of [0, 0.3, 0.7, 1.0, 1.5]) {
      expect(formatBudgetBar(ratio, 20).length).toBe(20)
    }
  })
})

describe('formatMessage', () => {
  const msg: Message = {
    id: 'abc', seq: 1, sessionId: 'sess-1',
    fromAgent: 'orchestrator', toAgent: 'executor',
    type: 'task_assigned', payload: {},
    timestamp: new Date('2024-06-01T10:23:45.000Z').getTime(),
    tokensIn: 0, tokensOut: 0,
  }

  it('includes fromAgent, toAgent, and type', () => {
    const result = formatMessage(msg)
    expect(result).toContain('orchestrator')
    expect(result).toContain('executor')
    expect(result).toContain('task_assigned')
  })

  it('includes a time in HH:MM:SS format', () => {
    expect(formatMessage(msg)).toMatch(/\[\d{2}:\d{2}:\d{2}\]/)
  })
})
