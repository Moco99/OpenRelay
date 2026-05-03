import type { Message } from '@openrelay/core'

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toTimeString().slice(0, 8)
}

export function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const hours = Math.floor(totalSecs / 3600)
  const mins  = Math.floor((totalSecs % 3600) / 60)
  const secs  = totalSecs % 60
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins  > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

export function formatMessage(msg: Message): string {
  return `[${formatTime(msg.timestamp)}] ${msg.fromAgent} → ${msg.toAgent}: ${msg.type}`
}

export function formatBudgetBar(ratio: number, width = 20): string {
  const filled = Math.min(Math.round(ratio * width), width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
