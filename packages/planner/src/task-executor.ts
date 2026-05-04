import type { MessageBus, Task } from '@openrelay/core'
import type { IAgentAdapter } from '@openrelay/adapters'
import type { BudgetTracker } from './budget-tracker.js'

export class TaskExecutor {
  constructor(
    private adapterFactory: () => IAgentAdapter,
    private bus: MessageBus,
    private sessionId: string,
    private agentId: string,
    private budgetTracker: BudgetTracker,
  ) {}

  async execute(task: Task): Promise<string> {
    const adapter = this.adapterFactory()

    this.bus.updateTask(task.id, { status: 'in_progress' })
    this.bus.upsertAgentState(this.sessionId, this.agentId, { status: 'working' })
    this.bus.publish({
      sessionId: this.sessionId,
      fromAgent: 'session',
      toAgent: this.agentId,
      type: 'task_assigned',
      payload: { taskId: task.id, title: task.title },
      tokensIn: 0, tokensOut: 0,
    })

    const prompt = this.formatPrompt(task)
    let output = ''

    for await (const chunk of adapter.send(prompt, [])) {
      if (chunk.type === 'text') output += chunk.content
      if (chunk.type === 'error') {
        const errContent = chunk.content
        this.bus.publish({
          sessionId: this.sessionId,
          fromAgent: this.agentId,
          toAgent: 'session',
          type: 'task_result',
          payload: { taskId: task.id, output: errContent, failed: true },
          tokensIn: 0, tokensOut: 0,
        })
        this.bus.updateTask(task.id, { status: 'failed', actualOutput: errContent })
        this.bus.upsertAgentState(this.sessionId, this.agentId, { status: 'error' })
        throw new Error(`Executor error: ${errContent}`)
      }
    }

    const usage = adapter.getTokensUsed()
    this.budgetTracker.update(this.agentId, usage)

    this.bus.publish({
      sessionId: this.sessionId,
      fromAgent: this.agentId,
      toAgent: 'session',
      type: 'task_result',
      payload: { taskId: task.id, output: output.slice(0, 500) },
      tokensIn: usage.input, tokensOut: usage.output,
    })
    this.bus.upsertAgentState(this.sessionId, this.agentId, { status: 'idle' })

    return output
  }

  private formatPrompt(task: Task): string {
    return [
      `Task: ${task.title}`,
      '',
      task.description,
      '',
      `Success criteria: ${task.successCriteria}`,
    ].join('\n')
  }
}
