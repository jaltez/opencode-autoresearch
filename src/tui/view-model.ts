import path from "node:path"
import { buildAutoresearchCompactionSummary } from "../core/compaction"
import type { MetricValue } from "../core/types"
import { buildFinalizePlan, renderFinalizePlan } from "../server/finalize"
import type { AutoresearchWorkspaceSnapshot } from "./data"

export interface AutoresearchTuiViewModel {
  command?: string
  finalizeGroups: Array<{
    branchName: string
    files: string
    iterations: string
    summary?: string
  }>
  finalizeText: string
  keptRuns: number
  latestRun?: {
    changedFiles: number
    decision: string
    iteration: number
    metrics: string
    status: string
    summary?: string
  }
  mode: "active" | "off" | "paused"
  name: string
  objective?: string
  pendingRuns: number
  promptLabel: string
  recentHook?: string
  relativeWorkDir: string
  runCount: number
  summaryText: string
  warningCount: number
}

export function buildAutoresearchTuiViewModel(snapshot: AutoresearchWorkspaceSnapshot): AutoresearchTuiViewModel {
  const keptRuns = snapshot.state.runs.filter((run) => run.decision === "keep" || run.status === "kept").length
  const pendingRuns = snapshot.state.runs.filter((run) => run.decision === "pending").length
  const latestRun = snapshot.state.runs.at(-1)
  const finalizePlan = buildFinalizePlan(snapshot.state.runs)
  const summaryText = buildAutoresearchCompactionSummary({
    ideasText: snapshot.ideasText,
    notesText: snapshot.notesText,
    state: snapshot.state,
  })

  return {
    command: snapshot.state.config?.command,
    finalizeGroups: finalizePlan.groups.map((group) => ({
      branchName: group.branchName,
      files: group.files.join(", ") || "none recorded",
      iterations: group.firstIteration === group.lastIteration
        ? `#${group.firstIteration}`
        : `#${group.firstIteration}-#${group.lastIteration}`,
      summary: group.summaries[0],
    })),
    finalizeText: renderFinalizePlan(finalizePlan),
    keptRuns,
    latestRun: latestRun
      ? {
          changedFiles: (latestRun.changes?.modified.length ?? 0) + (latestRun.changes?.untracked.length ?? 0),
          decision: latestRun.decision ?? "pending",
          iteration: latestRun.iteration,
          metrics: formatMetrics(latestRun.metrics),
          status: latestRun.status,
          summary: latestRun.summary,
        }
      : undefined,
    mode: snapshot.state.mode,
    name: snapshot.state.config?.name ?? "Autoresearch",
    objective: snapshot.state.config?.objective,
    pendingRuns,
    promptLabel: buildPromptLabel(snapshot.state.mode, latestRun?.iteration, pendingRuns),
    recentHook: snapshot.state.hooks.at(-1)?.message,
    relativeWorkDir: path.relative(snapshot.projectDir, snapshot.paths.directory) || ".",
    runCount: snapshot.state.runs.length,
    summaryText,
    warningCount: finalizePlan.warnings.length,
  }
}

function formatMetrics(metrics: readonly MetricValue[]): string {
  if (metrics.length === 0) return "none"
  return metrics.map((metric) => `${metric.name}=${metric.value}${metric.unit ?? ""}`).join(", ")
}

function buildPromptLabel(mode: "active" | "off" | "paused", latestIteration: number | undefined, pendingRuns: number): string {
  const parts = ["AR", mode]
  if (latestIteration !== undefined) parts.push(`#${latestIteration}`)
  if (pendingRuns > 0) parts.push(`${pendingRuns} pending`)
  return parts.join(" · ")
}