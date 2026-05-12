import path from "node:path"
import { buildAutoresearchCompactionSummary } from "./core/compaction"
import { currentSegment, currentSegmentRuns, findBaselineRun, findBestKeptRun } from "./core/jsonl"
import { computeRelativeChange, computeSegmentConfidence, findPrimaryMetric } from "./core/metrics"
import type { ResolvedAutoresearchPaths } from "./core/paths"
import type { AutoresearchState, ExperimentRun, MetricValue } from "./core/types"
import { buildFinalizePlan, renderFinalizePlan } from "./server/finalize"

export interface AutoresearchPresentationSignalRunSummary {
  asiSummary?: string
  confidence?: string
  iteration: number
  metric: string
  relativeChange?: string
  segment: number
  summary?: string
}

export interface AutoresearchPresentationModel {
  baselineRun?: AutoresearchPresentationSignalRunSummary
  benchmarkCommand?: string
  bestRun?: AutoresearchPresentationSignalRunSummary
  command?: string
  currentSegment: number
  currentSegmentRunCount: number
  finalizeGroups: Array<{
    branchName: string
    files: string
    iterations: string
    summary?: string
  }>
  finalizeText: string
  keptRuns: number
  latestRun?: {
    asiSummary?: string
    changedFiles: number
    confidence?: string
    decision: string
    iteration: number
    metrics: string
    nextActionHint?: string
    segment: number
    status: string
    summary?: string
  }
  mode: "active" | "off" | "paused"
  name: string
  nextActionHint?: string
  objective?: string
  pendingRuns: number
  promptLabel: string
  recentHook?: string
  relativeWorkDir: string
  runCount: number
  segmentConfidence: string
  summaryText: string
  warningCount: number
}

export interface AutoresearchPresentationInput {
  ideasText?: string
  notesText?: string
  paths: ResolvedAutoresearchPaths
  projectDir: string
  state: AutoresearchState
}

export function buildAutoresearchPresentationModel(input: AutoresearchPresentationInput): AutoresearchPresentationModel {
  const segment = currentSegment(input.state)
  const segmentRuns = currentSegmentRuns(input.state, -1)
  const baselineRun = findBaselineRun(input.state, segment)
  const bestRun = findBestKeptRun(input.state, segment)
  const baselineMetric = baselineRun ? findPrimaryMetric(baselineRun.metrics, input.state.config?.primaryMetric) : undefined
  const bestMetric = bestRun ? findPrimaryMetric(bestRun.metrics, input.state.config?.primaryMetric) : undefined
  const keptRuns = input.state.runs.filter((run) => run.decision === "keep" || run.status === "kept").length
  const pendingRuns = input.state.runs.filter((run) => run.decision === "pending").length
  const latestRun = input.state.runs.at(-1)
  const finalizePlan = buildFinalizePlan(input.state.runs)
  const summaryText = buildAutoresearchCompactionSummary({
    ideasText: input.ideasText,
    notesText: input.notesText,
    state: input.state,
  })

  return {
    baselineRun: buildSignalRunSummary(baselineRun, input.state.config?.primaryMetric),
    benchmarkCommand: input.state.config?.benchmarkCommand,
    bestRun: buildSignalRunSummary(bestRun, input.state.config?.primaryMetric, baselineMetric, bestMetric, baselineRun?.iteration),
    command: input.state.config?.command,
    currentSegment: segment,
    currentSegmentRunCount: segmentRuns.length,
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
          asiSummary: formatAsiSummary(latestRun.asi),
          changedFiles: (latestRun.changes?.modified.length ?? 0) + (latestRun.changes?.untracked.length ?? 0),
          confidence: formatRunConfidence(latestRun.confidence),
          decision: latestRun.decision ?? "pending",
          iteration: latestRun.iteration,
          metrics: formatMetrics(latestRun.metrics),
          nextActionHint: extractNextActionHint(latestRun.asi),
          segment: latestRun.segment ?? segment,
          status: latestRun.status,
          summary: latestRun.summary,
        }
      : undefined,
    mode: input.state.mode,
    name: input.state.config?.name ?? "Autoresearch",
    nextActionHint: extractNextActionHint(latestRun?.asi) ?? extractNextActionHint(bestRun?.asi),
    objective: input.state.config?.objective,
    pendingRuns,
    promptLabel: buildPromptLabel(input.state.mode, segment, latestRun?.iteration, pendingRuns),
    recentHook: input.state.hooks.at(-1)?.message,
    relativeWorkDir: path.relative(input.projectDir, input.paths.directory) || ".",
    runCount: input.state.runs.length,
    segmentConfidence: formatSegmentConfidence(computeSegmentConfidence(segmentRuns, input.state.config?.primaryMetric)),
    summaryText,
    warningCount: finalizePlan.warnings.length,
  }
}

function buildSignalRunSummary(
  run: ExperimentRun | undefined,
  primaryMetricName?: string,
  baselineMetric?: MetricValue,
  resolvedMetric?: MetricValue,
  baselineIteration?: number,
): AutoresearchPresentationSignalRunSummary | undefined {
  if (!run) return undefined

  const metric = resolvedMetric ?? findPrimaryMetric(run.metrics, primaryMetricName)
  return {
    asiSummary: formatAsiSummary(run.asi),
    confidence: formatRunConfidence(run.confidence),
    iteration: run.iteration,
    metric: metric ? formatMetric(metric) : formatMetrics(run.metrics),
    relativeChange: formatRelativeChange(metric, baselineMetric, baselineIteration),
    segment: run.segment ?? 1,
    summary: run.summary,
  }
}

function formatMetric(metric: MetricValue): string {
  return `${metric.name}=${metric.value}${metric.unit ?? ""}`
}

function formatMetrics(metrics: readonly MetricValue[]): string {
  if (metrics.length === 0) return "none"
  return metrics.map((metric) => formatMetric(metric)).join(", ")
}

function buildPromptLabel(mode: "active" | "off" | "paused", segment: number, latestIteration: number | undefined, pendingRuns: number): string {
  const parts = ["AR", mode, `s${segment}`]
  if (latestIteration !== undefined) parts.push(`#${latestIteration}`)
  if (pendingRuns > 0) parts.push(`${pendingRuns} pending`)
  return parts.join(" · ")
}

function formatRelativeChange(metric: MetricValue | undefined, baselineMetric: MetricValue | undefined, baselineIteration?: number): string | undefined {
  if (!metric || !baselineMetric || metric.name !== baselineMetric.name || metric.value === baselineMetric.value) return undefined
  const relative = computeRelativeChange(
    baselineMetric.value,
    metric.value,
    metric.higherIsBetter ?? baselineMetric.higherIsBetter ?? true,
  )
  const sign = relative > 0 ? "+" : ""
  return `${sign}${(relative * 100).toFixed(1)}% vs baseline${baselineIteration !== undefined ? ` #${baselineIteration}` : ""}`
}

function formatSegmentConfidence(confidence: number | null): string {
  if (confidence == null) return "not enough signal yet"
  if (confidence >= 2) return `${confidence.toFixed(1)}x noise floor - likely real`
  if (confidence >= 1) return `${confidence.toFixed(1)}x noise floor - above noise but marginal`
  return `${confidence.toFixed(1)}x noise floor - still within noise`
}

function formatRunConfidence(confidence: number | null | undefined): string | undefined {
  if (confidence == null) return undefined
  if (confidence >= 2) return `${confidence.toFixed(1)}x noise floor`
  if (confidence >= 1) return `${confidence.toFixed(1)}x noise floor (marginal)`
  return `${confidence.toFixed(1)}x noise floor`
}

function formatAsiSummary(asi: Record<string, unknown> | undefined): string | undefined {
  if (!asi) return undefined

  const entries = Object.entries(asi)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${collapseWhitespace(stringifyAsiValue(value)).slice(0, 72)}`)

  return entries.length > 0 ? entries.join(" | ") : undefined
}

function extractNextActionHint(asi: Record<string, unknown> | undefined): string | undefined {
  if (!asi) return undefined

  const candidates = [asi.next_action_hint, asi.next, asi.follow_up]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return collapseWhitespace(candidate)
  }

  return undefined
}

function stringifyAsiValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}