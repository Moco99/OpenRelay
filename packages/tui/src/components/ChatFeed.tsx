import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '@openrelay/core'
import { messageColor, agentColor } from '../colors.js'
import { formatTime } from '../format.js'

interface Props {
  messages: Message[]
  maxLines?: number
}

function payloadPreview(type: string, payload: unknown): string | null {
  const p = payload as Record<string, unknown>
  switch (type) {
    case 'task_assigned': {
      const title = String(p['title'] ?? '')
      return title ? `→ ${title}` : null
    }
    case 'task_result': {
      const output = String(p['output'] ?? '').replace(/\n/g, ' ').trim()
      return output ? output.slice(0, 90) + (output.length > 90 ? '…' : '') : null
    }
    case 'plan_generated': {
      const plan = p['plan'] as Record<string, unknown> | undefined
      const tasks = (plan?.['tasks'] ?? p['tasks']) as Array<{ title: string }> | undefined
      if (!tasks?.length) return null
      return `${tasks.length} task(s): ${tasks.map(t => t.title).join(' · ')}`
    }
    case 'checkpoint_request': {
      const event = String(p['event'] ?? '')
      return event ? `⚑ ${event}` : null
    }
    case 'checkpoint_response': {
      const decision = String(p['decision'] ?? '')
      return decision ? `${decision === 'approved' ? '✓' : decision === 'rejected' ? '✗' : '→'} ${decision}` : null
    }
    case 'deviation_detected': {
      const reason = String(p['reason'] ?? '').slice(0, 80)
      return reason ? `⚠ ${reason}` : null
    }
    case 'session_end':
      return '◼ session complete'
    default:
      return null
  }
}

export function ChatFeed({ messages, maxLines = 30 }: Props) {
  const visible = messages.slice(-maxLines)
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visible.map(msg => {
        const preview = payloadPreview(msg.type, msg.payload)
        return (
          <Box key={msg.id} flexDirection="column">
            <Box>
              <Text color="gray">[{formatTime(msg.timestamp)}] </Text>
              <Text color={agentColor(msg.fromAgent)} bold>{msg.fromAgent}</Text>
              <Text color="gray"> → </Text>
              <Text color={agentColor(msg.toAgent)}>{msg.toAgent}</Text>
              <Text color="gray">: </Text>
              <Text color={messageColor(msg.type)}>{msg.type}</Text>
            </Box>
            {preview && (
              <Box marginLeft={10}>
                <Text color="gray" dimColor>{preview}</Text>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
