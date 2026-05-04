import { useState, useEffect, useRef, useCallback } from 'react'
import type { MessageBus, Message, AgentState } from '@openrelay/core'
import {
  fetchNewMessages,
  findNextCheckpoint,
  parseCheckpoint,
  publishCheckpointResponse,
} from './poll.js'
import type { ActiveCheckpoint, CheckpointDecision } from './poll.js'

export function useAgentStates(bus: MessageBus, sessionId: string, intervalMs = 500): Map<string, AgentState> {
  const [states, setStates] = useState<Map<string, AgentState>>(new Map())

  useEffect(() => {
    const poll = () => {
      const list = bus.getAgentStates(sessionId)
      if (list.length > 0) {
        setStates(new Map(list.map(s => [s.agentId, s])))
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => clearInterval(id)
  }, [bus, sessionId, intervalMs])

  return states
}

export function useBusMessages(bus: MessageBus, sessionId: string, intervalMs = 100): Message[] {
  const [messages, setMessages] = useState<Message[]>([])
  const lastSeqRef = useRef(0)

  useEffect(() => {
    const poll = () => {
      const newMsgs = fetchNewMessages(bus, sessionId, lastSeqRef.current)
      if (newMsgs.length > 0) {
        lastSeqRef.current = newMsgs[newMsgs.length - 1]!.seq
        setMessages(prev => [...prev, ...newMsgs])
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => clearInterval(id)
  }, [bus, sessionId, intervalMs])

  return messages
}

export function useCheckpoint(
  bus: MessageBus,
  sessionId: string,
  messages: Message[],
): { active: ActiveCheckpoint | null; respond: (decision: CheckpointDecision, feedback?: string) => void } {
  const [active, setActive] = useState<ActiveCheckpoint | null>(null)
  const handledRef = useRef(new Set<string>())

  useEffect(() => {
    if (active) return
    const msg = findNextCheckpoint(messages, handledRef.current)
    if (msg) {
      handledRef.current.add(msg.id)
      setActive(parseCheckpoint(msg))
    }
  }, [messages, active])

  const respond = useCallback((decision: CheckpointDecision, feedback?: string) => {
    if (!active) return
    publishCheckpointResponse(bus, sessionId, active, decision, feedback)
    setActive(null)
  }, [bus, sessionId, active])

  return { active, respond }
}
