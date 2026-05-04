import React from 'react'
import { Box, Text } from 'ink'
import { homedir } from 'os'
import type { AgentConfig } from '@openrelay/core'

interface Props {
  agents: AgentConfig[]
  workingDir: string
}

function shortenDir(dir: string): string {
  const home = homedir()
  return dir.startsWith(home) ? '~' + dir.slice(home.length) : dir
}

export function Header({ agents, workingDir }: Props) {
  const planner  = agents.find(a => a.role === 'planner')
  const executor = agents.find(a => a.role === 'coder')

  return (
    <Box paddingX={1} gap={3} borderStyle="single" borderColor="gray">
      <Text bold color="cyan">OpenRelay v0.1.0</Text>
      {planner && (
        <Text color="gray">
          planner: <Text color="white">{planner.cli ?? planner.provider}</Text>
          <Text color="gray"> / </Text>
          <Text color="white">{planner.model}</Text>
        </Text>
      )}
      {executor && (
        <Text color="gray">
          executor: <Text color="white">{executor.cli ?? executor.provider}</Text>
          <Text color="gray"> / </Text>
          <Text color="white">{executor.model}</Text>
        </Text>
      )}
      <Text color="gray">{shortenDir(workingDir)}</Text>
    </Box>
  )
}
