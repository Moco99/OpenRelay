import React from 'react'
import { Box, Text } from 'ink'
import { formatDuration } from '../format.js'

interface Props {
  sessionId: string
  startedAt: number
  totalTokens: number
  messageCount: number
}

export function StatusBar({ sessionId, startedAt, totalTokens, messageCount }: Props) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} gap={3}>
      <Text color="gray">Session: <Text bold>{sessionId.slice(0, 8)}</Text></Text>
      <Text color="gray">Time: <Text bold>{formatDuration(Date.now() - startedAt)}</Text></Text>
      <Text color="gray">Tokens: <Text bold>{totalTokens.toLocaleString()}</Text></Text>
      <Text color="gray">Msgs: <Text bold>{messageCount}</Text></Text>
    </Box>
  )
}
