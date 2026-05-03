import type { MessageType } from '@openrelay/core'

export const MESSAGE_COLORS: Record<MessageType, string> = {
  task_assigned:      'cyan',
  task_result:        'green',
  task_progress:      'green',
  plan_generated:     'blue',
  deviation_detected: 'red',
  checkpoint_request: 'yellow',
  checkpoint_response:'yellow',
  memory_update:      'gray',
  session_end:        'magenta',
}

export function messageColor(type: MessageType): string {
  return MESSAGE_COLORS[type]
}

const AGENT_PALETTE = ['blue', 'green', 'cyan', 'magenta', 'yellow', 'white']

export function agentColor(agentId: string): string {
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0
  }
  return AGENT_PALETTE[Math.abs(hash) % AGENT_PALETTE.length]!
}
