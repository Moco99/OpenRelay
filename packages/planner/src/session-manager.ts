import { randomUUID } from 'crypto'
import { createAdapter } from '@openrelay/adapters'
import type { MessageBus, ProjectConfig } from '@openrelay/core'
import type { IAgentAdapter } from '@openrelay/adapters'
import { PlanGenerator } from './plan-generator.js'
import { DeviationDetector } from './deviation-detector.js'
import { BudgetTracker } from './budget-tracker.js'
import { TaskExecutor } from './task-executor.js'
import { CheckpointGate } from './checkpoint-gate.js'
import type { PlanTask } from './types.js'

interface SessionManagerOptions {
  checkpointPollMs?: number
  executorAdapterFactory?: () => IAgentAdapter
}

export class SessionManager {
  private sessionId: string

  constructor(
    private bus: MessageBus,
    private config: ProjectConfig,
    private plannerAdapter: IAgentAdapter,
    private options: SessionManagerOptions = {},
  ) {
    this.sessionId = randomUUID()
  }

  getSessionId(): string {
    return this.sessionId
  }

  async run(task: string): Promise<void> {
    const plannerConfig = this.config.agents.find(a => a.role === 'planner')
    const executorConfig = this.config.agents.find(a => a.role === 'coder')

    if (!plannerConfig) throw new Error('No agent with role "planner" found in config')
    if (!executorConfig) throw new Error('No agent with role "coder" found in config')

    this.bus.createSession(this.sessionId, this.config.session.workingDir, task)

    const pollMs = this.options.checkpointPollMs ?? 200
    const checkpointGate = new CheckpointGate(
      this.bus, this.sessionId, pollMs, this.config.session.checkpointTimeout * 1000,
    )
    const budgetTracker = new BudgetTracker(this.bus, this.sessionId, this.config.agents)
    const planGenerator = new PlanGenerator(
      this.plannerAdapter, this.bus, plannerConfig, this.sessionId,
    )
    const deviationDetector = new DeviationDetector(
      this.plannerAdapter, this.bus, plannerConfig, this.sessionId,
    )

    const adapterFactory = this.options.executorAdapterFactory
      ?? (() => createAdapter(executorConfig))
    const taskExecutor = new TaskExecutor(
      adapterFactory, this.bus, this.sessionId, executorConfig.id, budgetTracker,
    )

    // 1. Generate plan
    const plan = await planGenerator.generate(task)

    // 2. Checkpoint: plan_ready (if planner config requires it)
    if (plannerConfig.checkpoints.includes('plan_ready')) {
      const cpMsg = this.bus.publish({
        sessionId: this.sessionId,
        fromAgent: plannerConfig.id,
        toAgent: 'human',
        type: 'checkpoint_request',
        payload: { event: 'plan_ready', plan, agentId: plannerConfig.id },
        tokensIn: 0, tokensOut: 0,
      })
      const decision = await checkpointGate.waitForResponse(cpMsg.id)
      if (decision === 'rejected') {
        this.bus.updateSession(this.sessionId, { status: 'cancelled', endedAt: Date.now() })
        this.bus.publish({
          sessionId: this.sessionId,
          fromAgent: 'session', toAgent: 'session',
          type: 'session_end',
          payload: { reason: 'plan_rejected' },
          tokensIn: 0, tokensOut: 0,
        })
        return
      }
    }

    // 3. Execute tasks in insertion order
    const tasks = this.bus.getTasks(this.sessionId)
    const planTaskMap = new Map<string, PlanTask>(plan.tasks.map(t => [t.id, t]))
    const maxRetries = this.config.session.maxRetries

    for (const busTask of tasks) {
      const planTask = planTaskMap.get(busTask.id)
      const retryStrategy = planTask?.retryStrategy ?? 'resubmit'

      let output: string
      try {
        output = await taskExecutor.execute(busTask)
      } catch (err) {
        this.bus.updateSession(this.sessionId, { status: 'failed', endedAt: Date.now() })
        this.bus.publish({
          sessionId: this.sessionId,
          fromAgent: 'session', toAgent: 'session',
          type: 'session_end',
          payload: { reason: 'executor_error', error: String(err) },
          tokensIn: 0, tokensOut: 0,
        })
        return
      }

      let report = await deviationDetector.evaluate(busTask, output)

      // Retry once if deviation found and strategy allows
      if (!report.passed && retryStrategy !== 'none' && busTask.retries < maxRetries) {
        const retried = { ...busTask, retries: busTask.retries + 1, status: 'pending' as const }
        this.bus.updateTask(busTask.id, { retries: retried.retries, status: 'pending' })
        try {
          output = await taskExecutor.execute(retried)
          report = await deviationDetector.evaluate(retried, output)
        } catch {
          // retry failure is non-fatal — continue to next task
        }
      }

      // Escalate if still failing
      if (!report.passed && retryStrategy === 'escalate'
          && plannerConfig.checkpoints.includes('deviation_found')) {
        const cpMsg = this.bus.publish({
          sessionId: this.sessionId,
          fromAgent: plannerConfig.id,
          toAgent: 'human',
          type: 'checkpoint_request',
          payload: { event: 'deviation_found', report, agentId: plannerConfig.id },
          tokensIn: 0, tokensOut: 0,
        })
        await checkpointGate.waitForResponse(cpMsg.id)
      }
    }

    // 4. Complete
    this.bus.updateSession(this.sessionId, { status: 'completed', endedAt: Date.now() })
    this.bus.publish({
      sessionId: this.sessionId,
      fromAgent: 'session', toAgent: 'session',
      type: 'session_end',
      payload: { planId: plan.id },
      tokensIn: 0, tokensOut: 0,
    })
  }
}
