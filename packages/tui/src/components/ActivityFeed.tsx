import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { resolve, relative } from 'path'
import type { Message, AgentState } from '@openrelay/core'
import { agentColor } from '../colors.js'
import { formatTime } from '../format.js'

interface Props {
  messages: Message[]
  workingDir?: string
  agentStates?: Map<string, AgentState>
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

interface Activity {
  agent: string
  line: string
  detail?: string
  files?: string[]
  color?: string
}

// Matches:
//  1. Absolute/relative paths with extensions: ./foo.ts, /abs/bar.py, ~/dir/baz.rs
//  2. Bare filenames with extensions in backticks or quotes: `random_sum.py`, 'hello.txt'
const FILE_PATH_RE = /(?:^|\s|`|"|')([./~][\w./\\-]*\.[\w]{1,10})/gm
const BARE_FILE_RE = /[`'"]([\w][\w.-]*\.[\w]{1,10})[`'"]/gm

function extractFilePaths(text: string, workingDir: string): string[] {
  const paths: string[] = []
  let m: RegExpExecArray | null

  FILE_PATH_RE.lastIndex = 0
  while ((m = FILE_PATH_RE.exec(text)) !== null) {
    const p = m[1]
    if (!p) continue
    const abs = p.startsWith('/') ? p : resolve(workingDir, p)
    if (!paths.includes(abs)) paths.push(abs)
  }

  // Also extract bare filenames mentioned in quotes/backticks (e.g. `random_sum.py`)
  BARE_FILE_RE.lastIndex = 0
  while ((m = BARE_FILE_RE.exec(text)) !== null) {
    const p = m[1]
    if (!p) continue
    const abs = resolve(workingDir, p)
    if (!paths.includes(abs)) paths.push(abs)
  }

  return paths.slice(0, 6)
}

/**
 * Smart-split a long text into a short summary line and a detail block.
 * Unlike hard truncation, the full text is preserved — it just moves to `detail`.
 */
function smartSplit(text: string, maxSummary = 100): { summary: string; detail: string } {
  if (text.length <= maxSummary) return { summary: text, detail: '' }

  // Find a word boundary near the limit
  const cut = text.lastIndexOf(' ', maxSummary)
  const breakAt = cut > maxSummary * 0.5 ? cut : maxSummary
  return {
    summary: text.slice(0, breakAt),
    detail: text.slice(breakAt).trim(),
  }
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
      const output = String(p['output'] ?? '').trim().slice(0, 1000)
      const files = extractFilePaths(output, workingDir)

      if (failed) {
        return {
          agent: msg.fromAgent,
          line: `✗ Failed — ${output}`,
          color: 'red',
        }
      }

      return {
        agent: msg.fromAgent,
        line: `Done — ${output}`,
        ...(files.length > 0 ? { files } : {}),
      }
    }

    case 'task_progress': {
      const text = String(p['text'] ?? p['output'] ?? '').trim()
      if (!text) return null
      const rawLines = text.split('\n')
      const { summary, detail: overflow } = smartSplit(rawLines[0] ?? '', 100)
      const restLines = rawLines.slice(1).join('\n').trim()
      const detailParts = [overflow, restLines].filter(Boolean)
      const detailText = detailParts.join('\n').slice(0, 2000)
      return {
        agent: msg.fromAgent,
        line: summary || '…',
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
      const reason = String(p['reason'] ?? '')
      return {
        agent: msg.fromAgent,
        line: `⚠ Deviation${reason ? ` — ${reason}` : ''}`,
        color: 'yellow',
      }
    }

    case 'session_end': {
      const reason = String(p['reason'] ?? '')
      if (reason === 'executor_error') {
        const err = String(p['error'] ?? '').replace(/^(Error: )?(Executor error: )?/, '')
        return {
          agent: 'session',
          line: `✗ Session failed — ${err}`,
          color: 'red',
        }
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

// Fixed-width column for timestamp + agent name
const LABEL_WIDTH = 25

export function ActivityFeed({ messages, workingDir = process.cwd(), agentStates }: Props) {
  const entries: Array<{ msg: Message; activity: Activity }> = []
  for (const msg of messages) {
    const activity = toActivity(msg, workingDir)
    if (activity) entries.push({ msg, activity })
  }
  const visible = entries.slice(-25)

  // Animated spinner for when agents are working but no messages yet
  const [frame, setFrame] = useState(0)
  const isWorking = agentStates
    ? Array.from(agentStates.values()).some(s => s.status === 'working')
    : false
  const showSpinner = isWorking && visible.length === 0

  useEffect(() => {
    if (!showSpinner) return
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  }, [showSpinner])

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} borderStyle="single" borderColor="gray">
      <Text bold>Activity</Text>
      {showSpinner && (
        <Box marginTop={1}>
          <Text color="cyan">{SPINNER_FRAMES[frame]} </Text>
          <Text color="gray">Creating the plan...</Text>
        </Box>
      )}
      {visible.map(({ msg, activity }) => (
        <Box key={msg.id} flexDirection="column">
          <Box>
            <Box minWidth={LABEL_WIDTH} flexShrink={0}>
              <Text color="gray" dimColor>[{formatTime(msg.timestamp)}] </Text>
              <Text color={agentColor(activity.agent)} bold>{activity.agent}</Text>
            </Box>
            <Text color={activity.color ?? 'white'} wrap="wrap"> {activity.line}</Text>
          </Box>
          {activity.detail && (
            <Box marginLeft={LABEL_WIDTH} flexDirection="column">
              {activity.detail.split('\n').slice(0, 12).map((l, i) => (
                <Text key={i} color="gray" wrap="wrap">{l}</Text>
              ))}
            </Box>
          )}
          {activity.files && activity.files.length > 0 && (
            <Box marginLeft={LABEL_WIDTH} flexDirection="column">
              {activity.files.map((f, i) => {
                const rel = relative(workingDir, f) || f
                // OSC 8 hyperlink: \x1b]8;;URL\x07visible\x1b]8;;\x07
                const link = `\x1b]8;;file://${f}\x07${rel}\x1b]8;;\x07`
                return (
                  <Text key={i} color="cyan"> · {link}</Text>
                )
              })}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}
