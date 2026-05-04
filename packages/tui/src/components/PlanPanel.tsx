import React from 'react'
import { Box, Text } from 'ink'
import type { Message, MessageBus } from '@openrelay/core'

interface PlanTask {
  id: string
  title: string
}

interface Props {
  bus: MessageBus
  sessionId: string
  messages: Message[]
}

const STATUS_ICONS: Record<string, string> = {
  done:        '✓',
  in_progress: '●',
  pending:     '○',
  failed:      '✗',
}

const STATUS_COLORS: Record<string, string> = {
  done:        'green',
  in_progress: 'cyan',
  pending:     'gray',
  failed:      'red',
}

export function PlanPanel({ bus, sessionId, messages }: Props) {
  const planMsg = messages.find(m => m.type === 'plan_generated')
  if (!planMsg) return null

  const payload = planMsg.payload as { tasks?: PlanTask[] }
  const planTasks = payload.tasks ?? []
  if (planTasks.length === 0) return null

  const busTasks = bus.getTasks(sessionId)
  const taskMap = new Map(busTasks.map(t => [t.id, t.status]))

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} minWidth={32}>
      <Text bold>Plan</Text>
      {planTasks.map((t) => {
        const status = taskMap.get(t.id) ?? 'pending'
        const icon  = STATUS_ICONS[status]  ?? '○'
        const color = STATUS_COLORS[status] ?? 'gray'
        const title = t.title.length > 26 ? t.title.slice(0, 24) + '…' : t.title
        return (
          <Box key={t.id} marginTop={1} gap={1}>
            <Text color={color}>{icon}</Text>
            <Text color={color}>{title}</Text>
          </Box>
        )
      })}
    </Box>
  )
}
