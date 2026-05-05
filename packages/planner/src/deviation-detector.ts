import type { MessageBus, Task, AgentConfig } from '@openrelay/core'
import type { IAgentAdapter } from '@openrelay/adapters'
import { DEVIATION_PROMPT } from './prompts.js'
import type { DeviationReport } from './types.js'

export class DeviationDetector {
  constructor(
    private adapter: IAgentAdapter,
    private bus: MessageBus,
    private config: AgentConfig,
    private sessionId: string,
  ) {}

  async evaluate(task: Task, actualOutput: string): Promise<DeviationReport> {
    this.bus.upsertAgentState(this.sessionId, this.config.id, { status: 'working' })
    const initialUsage = this.adapter.getTokensUsed()
    
    try {
      const prompt = DEVIATION_PROMPT(task.title, task.successCriteria, actualOutput)
      let buffer = ''
    for await (const chunk of this.adapter.send(prompt, [])) {
      if (chunk.type === 'text') buffer += chunk.content
      if (chunk.type === 'error') throw new Error(`Adapter error: ${chunk.content}`)
    }

    const report = this.parseReport(task.id, buffer)

    this.bus.updateTask(task.id, {
      actualOutput,
      deviationReport: report.passed ? null : JSON.stringify(report),
      status: report.passed ? 'done' : 'failed',
    })

    if (!report.passed) {
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
        type: 'deviation_detected',
        payload: report,
        tokensIn: deltaIn,
        tokensOut: deltaOut,
      })
    }

    return report
    } finally {
      this.bus.upsertAgentState(this.sessionId, this.config.id, { status: 'idle' })
    }
  }

  private parseReport(taskId: string, raw: string): DeviationReport {
    try {
      const first = raw.indexOf('{')
      const last  = raw.lastIndexOf('}')
      const json  = first !== -1 && last !== -1 ? raw.slice(first, last + 1) : raw
      const obj   = JSON.parse(json) as Record<string, unknown>
      const rawSeverity = String(obj['severity'] ?? 'major')
      const severity = (['minor', 'major', 'critical'].includes(rawSeverity)
        ? rawSeverity
        : 'major') as DeviationReport['severity']
      return {
        taskId,
        passed: Boolean(obj['passed']),
        reason: String(obj['reason'] ?? ''),
        severity,
        ...(obj['suggestion'] !== undefined ? { suggestion: String(obj['suggestion']) } : {}),
      }
    } catch {
      return {
        taskId,
        passed: false,
        reason: `Failed to parse evaluator response: ${raw.slice(0, 200)}`,
        severity: 'major',
      }
    }
  }
}
