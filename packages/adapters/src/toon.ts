import { encode } from '@toon-format/toon'
import type { Message, Task } from '@openrelay/core'

interface MsgRecord  { seq: number; from: string; type: string; content: string }
interface TaskRecord { id: string; title: string; status: string; criteria: string }

// Serialize active working memory (messages + tasks) into TOON for LLM prompt injection.
// Call this when building a prompt — never store the result in SQLite.
export function serializeWorkingMemory(messages: Message[], tasks: Task[]): string {
  const msgs: MsgRecord[] = messages.map(m => ({
    seq: m.seq,
    from: m.fromAgent,
    type: m.type,
    content: typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload),
  }))
  const tsks: TaskRecord[] = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    criteria: t.successCriteria,
  }))
  return encode({ messages: msgs, tasks: tsks })
}

// Serialize a session summary for injection into the next prompt turn.
// messagesCovered tells the LLM how many messages this summary compresses.
export function serializeSessionSummary(summary: string, messagesCovered: number): string {
  return encode({ session_summary: [{ content: summary, messages_covered: messagesCovered }] })
}
