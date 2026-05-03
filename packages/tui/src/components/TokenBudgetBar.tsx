import React from 'react'
import { Box, Text } from 'ink'
import { formatBudgetBar } from '../format.js'

interface Props {
  ratio: number
  width?: number
}

export function TokenBudgetBar({ ratio, width = 16 }: Props) {
  const bar   = formatBudgetBar(ratio, width)
  const pct   = Math.round(ratio * 100)
  const color = ratio >= 1.0 ? 'red' : ratio >= 0.9 ? 'redBright' : ratio >= 0.8 ? 'yellow' : 'green'
  return (
    <Box>
      <Text color={color}>{bar}</Text>
      <Text color={color}> {pct}%</Text>
    </Box>
  )
}
