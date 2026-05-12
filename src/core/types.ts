export type AutoresearchMode = "active" | "off" | "paused"

export type RunStatus =
  | "completed"
  | "crashed"
  | "discarded"
  | "failed"
  | "checks_failed"
  | "kept"
  | "running"

export type RunDecision = "discard" | "keep" | "pending" | "retry"

export interface MetricValue {
  name: string
  value: number
  unit?: string
  higherIsBetter?: boolean
}

export interface SecondaryMetricDefinition {
  higherIsBetter: boolean
  unit?: string
}

export type SecondaryMetricRegistry = Record<string, SecondaryMetricDefinition>

export interface ExperimentCheckResult {
  command: string
  exitCode: number
  output?: string
  passed: boolean
}

export interface ExperimentConfig {
  command: string
  createdAt: string
  maxIterations?: number
  name: string
  objective?: string
  primaryMetric?: string
  workDir?: string
  checks?: string[]
}

export interface ExperimentRun {
  id: string
  iteration: number
  startedAt: string
  endedAt?: string
  command: string
  status: RunStatus
  decision?: RunDecision
  summary?: string
  output?: string
  exitCode?: number
  metrics: MetricValue[]
  checks?: ExperimentCheckResult[]
  commit?: string
  changes?: {
    modified: string[]
    untracked: string[]
  }
  error?: string
}

export interface HookInvocation {
  at: string
  exitCode?: number
  kind: "after" | "before"
  message?: string
  scriptPath: string
  status: "failed" | "ok" | "skipped" | "timed_out"
  stderr?: string
  stdout?: string
}

export interface AutoresearchState {
  config?: ExperimentConfig
  hooks: HookInvocation[]
  lastUpdatedAt?: string
  mode: AutoresearchMode
  notes: string[]
  runs: ExperimentRun[]
  secondaryMetrics: SecondaryMetricRegistry
}

export interface SessionEntry {
  at: string
  config: ExperimentConfig
  mode?: AutoresearchMode
  type: "session"
}

export interface ModeEntry {
  at: string
  mode: AutoresearchMode
  reason?: string
  type: "mode"
}

export interface RunEntry {
  at: string
  run: ExperimentRun
  type: "run"
}

export interface NoteEntry {
  at: string
  markdown: string
  type: "note"
}

export interface HookEntry {
  at: string
  hook: HookInvocation
  type: "hook"
}

export type AutoresearchJsonlEntry = HookEntry | ModeEntry | NoteEntry | RunEntry | SessionEntry

export function createEmptyState(): AutoresearchState {
  return {
    hooks: [],
    mode: "off",
    notes: [],
    runs: [],
    secondaryMetrics: {},
  }
}
