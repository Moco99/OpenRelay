import React from 'react'
import { Box, Text } from 'ink'
import { resolve } from 'path'
import type { Message } from '@openrelay/core'
import { agentColor } from '../colors.js'
import { formatTime } from '../format.js'

interface Props {
  messages: Message[]
  workingDir?: string
}

interface Activity {
  agent: string
  line: string
  detail?: string
  files?: string[]
  color?: string
}

// Matches absolute or relative paths with a file extension
const FILE_PATH_RE = /(?:^|\s|`|"|')([./~][\w./\\-]*\.[\w]{1,10})/gm

function extractFilePaths(text: string): string[] {
  const paths: string[] = []
  let m: RegExpExecArray | null
  FILE_PATH_RE.lastIndex = 0
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    const p = m[1]
    if (p && !paths.includes(p)) paths.push(p)
  }
  return paths.slice(0, 8)
}

function fileLink(filePath: string, workingDir: string): string {
  const abs = filePath.startsWith('/') ? filePath : resolve(workingDir, filePath)
  // OSC 8 hyperlink: \x1b]8;;URL\x1b\\ text \x1b]8;;\x1b\\
  return `\x1b]8;;file://${abs}\x1b\\${filePath}\x1b]8;;\x1b\\`
}

function toActivity(msg: Message, workingDir: string): Activity | null {
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
      const failed = Boolean(p['failed'])
      const output = String(p['output'] ?? '').trim()
      const lines = output.split('\n')
      const firstLine = lines[0]?.slice(0, 70) ?? ''

      if (failed) {
        const detailText = lines.slice(1).join('\n').trim().slice(0, 600)
        return {
          agent: msg.fromAgent,
          line: `✗ Failed — ${firstLine}`,
          ...(detailText ? { detail: detailText } : {}),
          color: 'red',
        }
      }

      const rest = lines.slice(1).join('\n').trim()
      const files = extractFilePaths(output)
      return {
        agent: msg.fromAgent,
        line: `Done${firstLine ? ` — ${firstLine}` : ''}`,
        ...(rest ? { detail: rest.slice(0, 600) } : {}),
        ...(files.length > 0 ? { files: files.map(f => fileLink(f, workingDir)) } : {}),
      }
    }

    case 'task_progress': {
      const text = String(p['text'] ?? p['output'] ?? '').trim()
      if (!text) return null
      const lines = text.split('\n')
      const detailText = lines.slice(1).join('\n').trim().slice(0, 400)
      return {
        agent: msg.fromAgent,
        line: lines[0]?.slice(0, 80) ?? '…',
        ...(detailText ? { detail: detailText } : {}),
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
      return { agent: msg.fromAgent, line: `⚠ Deviation${reason ? ` — ${reason}` : ''}`, color: 'yellow' }
    }

    case 'session_end': {
      const reason = String(p['reason'] ?? '')
      if (reason === 'executor_error') {
        const err = String(p['error'] ?? '').replace(/^(Error: )?(Executor error: )?/, '').slice(0, 100)
        return { agent: 'session', line: `✗ Session failed — ${err}`, color: 'red' }
      }
      if (reason === 'plan_rejected') {
        return { agent: 'session', line: '◼ Plan rejected' }
      }
      return { agent: 'session', line: '◼ Session complete' }
    }

    default:
      return null
  }
}

export function ActivityFeed({ messages, workingDir = process.cwd() }: Props) {
  const entries: Array<{ msg: Message; activity: Activity }> = []
  for (const msg of messages) {
    const activity = toActivity(msg, workingDir)
    if (activity) entries.push({ msg, activity })
  }
  const visible = entries.slice(-25)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} borderStyle="single" borderColor="gray">
      <Text bold>Activity</Text>
      {visible.map(({ msg, activity }) => (
        <Box key={msg.id} flexDirection="column">
          <Box>
            <Text color="gray" dimColor>[{formatTime(msg.timestamp)}] </Text>
            <Text color={agentColor(activity.agent)} bold>{activity.agent.padEnd(13)}</Text>
            <Text color={activity.color ?? 'white'}> {activity.line}</Text>
          </Box>
          {activity.detail && (
            <Box marginLeft={24} flexDirection="column">
              {activity.detail.split('\n').slice(0, 10).map((l, i) => (
                <Text key={i} color="gray">{l}</Text>
              ))}
            </Box>
          )}
          {activity.files && activity.files.length > 0 && (
            <Box marginLeft={24} flexDirection="column">
              {activity.files.map((f, i) => (
                <Text key={i} color="cyan">{f}</Text>
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}
