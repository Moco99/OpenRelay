import React from 'react'
import { Box } from 'ink'
import type { AgentConfig, MessageBus } from '@openrelay/core'
import { useBusMessages, useCheckpoint, useAgentStates } from '../hooks.js'
import { Header } from './Header.js'
import { ActivityFeed } from './ActivityFeed.js'
import { CheckpointPrompt } from './CheckpointPrompt.js'
import { StatusBar } from './StatusBar.js'

interface Props {
  bus: MessageBus
  sessionId: string
  agents: AgentConfig[]
  startedAt: number
  workingDir?: string
}

export function Dashboard({ bus, sessionId, agents, startedAt, workingDir = process.cwd() }: Props) {
  const messages    = useBusMessages(bus, sessionId)
  const agentStates = useAgentStates(bus, sessionId)
  const { active, respond } = useCheckpoint(bus, sessionId, messages)

  const totalTokens = Array.from(agentStates.values())
    .reduce((sum, s) => sum + s.tokensIn + s.tokensOut, 0)

  return (
    <Box flexDirection="column">
      <Header agents={agents} workingDir={workingDir} />
      <ActivityFeed messages={messages} />
      {active && <CheckpointPrompt checkpoint={active} onRespond={respond} />}
      <StatusBar
        sessionId={sessionId}
        startedAt={startedAt}
        totalTokens={totalTokens}
        messageCount={messages.length}
      />
    </Box>
  )
}
