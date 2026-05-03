// Intermediate form of a plan task as the LLM produces it.
// Maps to core Task when persisted to the bus.
export interface PlanTask {
  id: string
  order: number
  title: string
  description: string
  successCriteria: string
  assignedTo: string
  dependsOn: string[]
  retryStrategy: 'none' | 'resubmit' | 'escalate'
}

export interface Plan {
  id: string
  sessionId: string
  originalTask: string
  tasks: PlanTask[]
  createdAt: number
}

export interface DeviationReport {
  taskId: string
  passed: boolean
  reason: string
  severity: 'minor' | 'major' | 'critical'
  suggestion?: string
}

// 'warning' ≥80%, 'critical' ≥90%, 'exceeded' ≥100%
export type BudgetStatus = 'ok' | 'warning' | 'critical' | 'exceeded'
