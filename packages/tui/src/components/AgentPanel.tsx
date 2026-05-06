import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { AgentConfig, AgentState } from '@openrelay/core'
import { agentColor } from '../colors.js'
import { formatThinBar } from '../format.js'

interface Props {
  agents: AgentConfig[]
  states: Map<string, AgentState>
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FUNNY_VERBS = [
  'Combusting...', 'Equalizing...', 'Synthesizing...', 'Reticulating splines...',
  'Calculating vectors...', 'Analyzing spacetime...', 'Bending reality...'
]

function useSpinner(active: boolean) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setFrame(f => f + 1), 80)
    return () => clearInterval(timer)
  }, [active])
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!
}

function useFunnyVerb(active: boolean) {
  const [verbIdx, setVerbIdx] = useState(0)
  useEffect(() => {
    if (!active) return
    setVerbIdx(Math.floor(Math.random() * FUNNY_VERBS.length))
    const timer = setInterval(() => {
      setVerbIdx(Math.floor(Math.random() * FUNNY_VERBS.length))
    }, 4000)
    return () => clearInterval(timer)
  }, [active])
  return FUNNY_VERBS[verbIdx]!
}

function AgentRow({ agent, state }: { agent: AgentConfig; state?: AgentState | undefined }) {
  const tokens = state ? state.tokensIn + state.tokensOut : 0
  const ratio  = tokens / agent.tokenBudget
  const status = state?.status ?? 'idle'
  const circleColor = status === 'working' ? 'green' : status === 'error' ? 'red' : 'gray'
  const barColor    = ratio >= 1.0 ? 'red' : ratio >= 0.9 ? 'redBright' : ratio >= 0.8 ? 'yellow' : 'green'

  const spinner = useSpinner(status === 'working')
  const verb = useFunnyVerb(status === 'working')
  const icon = status === 'working' ? spinner : '●'

  return (
    <Box flexDirection="column" minWidth={35}>
      <Box gap={1}>
        <Text color={circleColor}>{icon}</Text>
        <Text color={agentColor(agent.id)} bold>{agent.id}</Text>
        {status === 'working' && <Text color="dim" dimColor>{verb}</Text>}
      </Box>
      <Text color={barColor}>{formatThinBar(ratio, 8)} {Math.round(ratio * 100)}%</Text>
      <Text color="gray">{tokens.toLocaleString()} / {agent.tokenBudget.toLocaleString()}</Text>
    </Box>
  )
}

export function AgentPanel({ agents, states }: Props) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Agents</Text>
      <Box flexDirection="row" gap={3} marginTop={1}>
        {agents.map(agent => (
          <AgentRow key={agent.id} agent={agent} state={states.get(agent.id)} />
        ))}
      </Box>
    </Box>
  )
}
