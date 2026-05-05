import { randomUUID } from 'crypto'
import type { MessageBus, AgentConfig } from '@openrelay/core'
import type { IAgentAdapter } from '@openrelay/adapters'
import { PLAN_PROMPT } from './prompts.js'
import { buildContext } from './context.js'
import type { Plan, PlanTask } from './types.js'

export class PlanGenerator {
  constructor(
    private adapter: IAgentAdapter,
    private bus: MessageBus,
    private config: AgentConfig,
    private sessionId: string,
  ) {}

  async generate(task: string): Promise<Plan> {
    this.bus.upsertAgentState(this.sessionId, this.config.id, { status: 'working' })
    const initialUsage = this.adapter.getTokensUsed()
    
    try {
      const workingMemory = buildContext(this.bus, this.sessionId)
      const prompt = PLAN_PROMPT(task, workingMemory)
    const raw = await this.collectResponse(prompt)
    const tasks = this.parsePlanTasks(raw)

    const plan: Plan = {
      id: randomUUID(),
      sessionId: this.sessionId,
      originalTask: task,
      tasks,
      createdAt: Date.now(),
    }

    for (const t of tasks) {
      const busId = randomUUID()
      t.id = busId  // keep plan task ID in sync with bus ID
      this.bus.createTask({
        id: busId,
        sessionId: this.sessionId,
        planId: plan.id,
        title: t.title,
        description: t.description,
        successCriteria: t.successCriteria,
        assignedTo: t.assignedTo,
        planExpectation: t.successCriteria,
      })
    }

    const finalUsage = this.adapter.getTokensUsed()
    const deltaIn = finalUsage.input - initialUsage.input
    const deltaOut = finalUsage.output - initialUsage.output

    this.bus.upsertAgentState(this.sessionId, this.config.id, {
      tokensIn: deltaIn,
      tokensOut: deltaOut,
    })

    this.bus.publish({
      sessionId: this.sessionId,
      fromAgent: this.config.id,
      toAgent: 'session',
      type: 'plan_generated',
      payload: plan,
      tokensIn: deltaIn,
      tokensOut: deltaOut,
    })

    return plan
    } finally {
      this.bus.upsertAgentState(this.sessionId, this.config.id, { status: 'idle' })
    }
  }

  private async collectResponse(prompt: string): Promise<string> {
    let buffer = ''
    for await (const chunk of this.adapter.send(prompt, [])) {
      if (chunk.type === 'text') buffer += chunk.content
      if (chunk.type === 'error') throw new Error(`Adapter error: ${chunk.content}`)
    }
    return buffer
  }

  private parsePlanTasks(raw: string): PlanTask[] {
    const json = extractJson(raw)
    const parsed = JSON.parse(json) as { tasks: unknown[] }
    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      throw new Error('Plan must contain at least one task')
    }
    return parsed.tasks.map((t, i) => {
      const task = t as Record<string, unknown>
      const rawRetry = String(task['retryStrategy'] ?? task['retry_strategy'] ?? 'resubmit')
      return {
        id: String(task['id'] ?? `task-${i + 1}`),
        order: typeof task['order'] === 'number' ? task['order'] : i + 1,
        title: String(task['title'] ?? ''),
        description: String(task['description'] ?? ''),
        successCriteria: String(task['successCriteria'] ?? task['success_criteria'] ?? ''),
        assignedTo: String(task['assignedTo'] ?? task['assigned_to'] ?? 'executor'),
        dependsOn: Array.isArray(task['dependsOn']) ? task['dependsOn'].map(String) : [],
        retryStrategy: (['none', 'resubmit', 'escalate'].includes(rawRetry)
          ? rawRetry
          : 'resubmit') as PlanTask['retryStrategy'],
      }
    })
  }
}

// Strips markdown code fences; falls back to extracting the outermost {...} block.
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) return fenced[1].trim()
  const first = raw.indexOf('{')
  const last  = raw.lastIndexOf('}')
  if (first !== -1 && last !== -1) return raw.slice(first, last + 1)
  return raw.trim()
}
