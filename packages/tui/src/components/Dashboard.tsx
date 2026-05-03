import React from 'react'
import { Box, Text } from 'ink'
import type { AgentConfig, AgentState, MessageBus } from '@openrelay/core'
import { useBusMessages, useCheckpoint } from '../hooks.js'
import { AgentPanel } from './AgentPanel.js'
import { ChatFeed } from './ChatFeed.js'
import { CheckpointPrompt } from './CheckpointPrompt.js'
import { StatusBar } from './StatusBar.js'

interface Props {
  bus: MessageBus
  sessionId: string
  agents: AgentConfig[]
  startedAt: number
  agentStates?: Map<string, AgentState>
}

export function Dashboard({ bus, sessionId, agents, startedAt, agentStates = new Map() }: Props) {
  const messages = useBusMessages(bus, sessionId)
  const { active, respond } = useCheckpoint(bus, sessionId, messages)

  const totalTokens = Array.from(agentStates.values())
    .reduce((sum, s) => sum + s.tokensIn + s.tokensOut, 0)

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text bold color="cyan">OpenRelay</Text>
        <Text color="gray"> — session {sessionId.slice(0, 8)}</Text>
      </Box>
      <Box flexGrow={1}>
        <AgentPanel agents={agents} states={agentStates} />
        <Box flexDirection="column" flexGrow={1}>
          <ChatFeed messages={messages} />
          {active && <CheckpointPrompt checkpoint={active} onRespond={respond} />}
        </Box>
      </Box>
      <StatusBar
        sessionId={sessionId}
        startedAt={startedAt}
        totalTokens={totalTokens}
        messageCount={messages.length}
      />
    </Box>
  )
}
