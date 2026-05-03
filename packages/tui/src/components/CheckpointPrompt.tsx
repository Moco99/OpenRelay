import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ActiveCheckpoint, CheckpointDecision } from '../poll.js'

interface Props {
  checkpoint: ActiveCheckpoint
  onRespond: (decision: CheckpointDecision, feedback?: string) => void
}

export function CheckpointPrompt({ checkpoint, onRespond }: Props) {
  const [mode, setMode]         = useState<'ask' | 'edit'>('ask')
  const [feedback, setFeedback] = useState('')

  useInput((input, key) => {
    if (mode === 'ask') {
      if (input === 'y' || input === 'Y' || key.return) onRespond('approved')
      else if (input === 'n' || input === 'N')          onRespond('rejected')
      else if (input === 's' || input === 'S')          onRespond('skipped')
      else if (input === 'e' || input === 'E')          setMode('edit')
    } else {
      if (key.return)                        onRespond('rejected', feedback || undefined)
      else if (key.escape)                   { setMode('ask'); setFeedback('') }
      else if (key.backspace || key.delete)  setFeedback(prev => prev.slice(0, -1))
      else if (input)                        setFeedback(prev => prev + input)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow" bold>⚠ CHECKPOINT: {checkpoint.event}</Text>
      {mode === 'ask' ? (
        <Text>
          <Text bold color="green">[Y]</Text><Text>es  </Text>
          <Text bold color="red">[n]</Text><Text>o  </Text>
          <Text bold color="cyan">[e]</Text><Text>dit  </Text>
          <Text bold color="gray">[s]</Text><Text>kip</Text>
        </Text>
      ) : (
        <Box flexDirection="column">
          <Text color="cyan">Feedback (Enter=submit  Esc=cancel):</Text>
          <Text>{feedback}<Text color="green">▌</Text></Text>
        </Box>
      )}
    </Box>
  )
}
