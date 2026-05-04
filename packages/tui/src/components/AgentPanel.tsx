import React from 'react'
import { Box, Text } from 'ink'
import type { AgentConfig, AgentState } from '@openrelay/core'
import { agentColor } from '../colors.js'
import { formatThinBar } from '../format.js'

interface Props {
  agents: AgentConfig[]
  states: Map<string, AgentState>
}

export function AgentPanel({ agents, states }: Props) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Agents</Text>
      <Box flexDirection="row" gap={3} marginTop={1}>
        {agents.map(agent => {
          const state  = states.get(agent.id)
          const tokens = state ? state.tokensIn + state.tokensOut : 0
          const ratio  = tokens / agent.tokenBudget
          const status = state?.status ?? 'idle'
          const circleColor = status === 'working' ? 'green' : status === 'error' ? 'red' : 'gray'
          const barColor    = ratio >= 1.0 ? 'red' : ratio >= 0.9 ? 'redBright' : ratio >= 0.8 ? 'yellow' : 'green'
          return (
            <Box key={agent.id} flexDirection="column" minWidth={20}>
              <Box gap={1}>
                <Text color={circleColor}>●</Text>
                <Text color={agentColor(agent.id)} bold>{agent.id}</Text>
              </Box>
              <Text color={barColor}>{formatThinBar(ratio, 8)} {Math.round(ratio * 100)}%</Text>
              <Text color="gray">{tokens.toLocaleString()} / {agent.tokenBudget.toLocaleString()}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
