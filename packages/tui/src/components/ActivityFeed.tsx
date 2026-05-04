import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '@openrelay/core'
import { agentColor } from '../colors.js'
import { formatTime } from '../format.js'

interface Props {
  messages: Message[]
}

interface Activity {
  agent: string
  line: string
  detail?: string
}

function toActivity(msg: Message): Activity | null {
  const p = msg.payload as Record<string, unknown>

  switch (msg.type) {
    case 'plan_generated': {
      const plan = p['plan'] as Record<string, unknown> | undefined
      const tasks = (plan?.['tasks'] ?? p['tasks']) as Array<{ title: string }> | undefined
      if (!tasks?.length) return { agent: msg.fromAgent, line: 'Plan generated' }
      return {
        agent: msg.fromAgent,
        line: `Plan generated — ${tasks.length} task${tasks.length > 1 ? 's' : ''}`,
        detail: tasks.map(t => `  ○ ${t.title}`).join('\n'),
      }
    }

    case 'task_assigned': {
      const title = String(p['title'] ?? '')
      return {
        agent: msg.toAgent,
        line: `Task received${title ? ` — ${title}` : ''}`,
      }
    }

    case 'task_result': {
      const output = String(p['output'] ?? '').trim()
      const lines = output.split('\n')
      const firstLine = lines[0]?.slice(0, 70) ?? ''
      const rest = lines.slice(1).join('\n').trim()
      return {
        agent: msg.fromAgent,
        line: `Done${firstLine ? ` — ${firstLine}` : ''}`,
        detail: rest ? rest.slice(0, 600) : undefined,
      }
    }

    case 'task_progress': {
      const text = String(p['text'] ?? p['output'] ?? '').trim()
      if (!text) return null
      const lines = text.split('\n')
      return {
        agent: msg.fromAgent,
        line: lines[0]?.slice(0, 80) ?? '…',
        detail: lines.slice(1).join('\n').trim().slice(0, 400) || undefined,
      }
    }

    case 'checkpoint_request': {
      const event = String(p['event'] ?? '')
      return { agent: msg.fromAgent, line: `⚑ Checkpoint${event ? `: ${event}` : ''}` }
    }

    case 'checkpoint_response': {
      const decision = String(p['decision'] ?? '')
      const icon = decision === 'approved' ? '✓' : decision === 'rejected' ? '✗' : '→'
      return { agent: msg.fromAgent === 'human' ? 'human' : msg.fromAgent, line: `${icon} ${decision}` }
    }

    case 'deviation_detected': {
      const reason = String(p['reason'] ?? '').slice(0, 80)
      return { agent: msg.fromAgent, line: `⚠ Deviation${reason ? ` — ${reason}` : ''}` }
    }

    case 'session_end':
      return { agent: 'session', line: '◼ Session complete' }

    default:
      return null
  }
}

export function ActivityFeed({ messages }: Props) {
  const entries: Array<{ msg: Message; activity: Activity }> = []
  for (const msg of messages) {
    const activity = toActivity(msg)
    if (activity) entries.push({ msg, activity })
  }
  const visible = entries.slice(-25)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visible.map(({ msg, activity }) => (
        <Box key={msg.id} flexDirection="column">
          <Box>
            <Text color="gray" dimColor>[{formatTime(msg.timestamp)}] </Text>
            <Text color={agentColor(activity.agent)} bold>{activity.agent.padEnd(13)}</Text>
            <Text color="white"> {activity.line}</Text>
          </Box>
          {activity.detail && (
            <Box marginLeft={24} flexDirection="column">
              {activity.detail.split('\n').slice(0, 10).map((l, i) => (
                <Text key={i} color="gray">{l}</Text>
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}
