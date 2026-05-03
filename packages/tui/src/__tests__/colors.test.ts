import { describe, it, expect } from 'bun:test'
import { messageColor, agentColor, MESSAGE_COLORS } from '../colors.js'
import type { MessageType } from '@openrelay/core'

describe('messageColor', () => {
  it('returns a color for every defined message type', () => {
    for (const type of Object.keys(MESSAGE_COLORS) as MessageType[]) {
      expect(typeof messageColor(type)).toBe('string')
      expect(messageColor(type).length).toBeGreaterThan(0)
    }
  })

  it('returns red for deviation_detected', () => {
    expect(messageColor('deviation_detected')).toBe('red')
  })

  it('returns yellow for checkpoint_request', () => {
    expect(messageColor('checkpoint_request')).toBe('yellow')
  })

  it('returns green for task_result', () => {
    expect(messageColor('task_result')).toBe('green')
  })

  it('returns blue for plan_generated', () => {
    expect(messageColor('plan_generated')).toBe('blue')
  })
})

describe('agentColor', () => {
  it('returns a non-empty string for any agent id', () => {
    expect(typeof agentColor('orchestrator')).toBe('string')
    expect(agentColor('orchestrator').length).toBeGreaterThan(0)
  })

  it('is deterministic — same id always returns same color', () => {
    expect(agentColor('executor')).toBe(agentColor('executor'))
    expect(agentColor('orchestrator')).toBe(agentColor('orchestrator'))
  })

  it('handles empty string without crashing', () => {
    expect(() => agentColor('')).not.toThrow()
  })

  it('different agent ids can produce different colors', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(agentColor))
    expect(colors.size).toBeGreaterThan(1)
  })
})
