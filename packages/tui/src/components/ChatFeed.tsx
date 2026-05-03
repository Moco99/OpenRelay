import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '@openrelay/core'
import { messageColor, agentColor } from '../colors.js'
import { formatTime } from '../format.js'

interface Props {
  messages: Message[]
  maxLines?: number
}

export function ChatFeed({ messages, maxLines = 24 }: Props) {
  const visible = messages.slice(-maxLines)
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visible.map(msg => (
        <Box key={msg.id}>
          <Text color="gray">[{formatTime(msg.timestamp)}] </Text>
          <Text color={agentColor(msg.fromAgent)} bold>{msg.fromAgent}</Text>
          <Text color="gray"> → </Text>
          <Text color={agentColor(msg.toAgent)}>{msg.toAgent}</Text>
          <Text color="gray">: </Text>
          <Text color={messageColor(msg.type)}>{msg.type}</Text>
        </Box>
      ))}
    </Box>
  )
}
