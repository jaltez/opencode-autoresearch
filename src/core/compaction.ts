import { currentSegment, currentSegmentRuns, extractAutoresearchSessionName, findBaselineRun, findBestKeptRun } from "./jsonl"
import { computeRelativeChange, computeSegmentConfidence, findPrimaryMetric } from "./metrics"
import type { AutoresearchState, ExperimentRun } from "./types"

export interface CompactionSummaryInput {
  ideasText?: string
  maxRuns?: number
  notesText?: string
  state: AutoresearchState
}

export function buildAutoresearchCompactionSummary(input: CompactionSummaryInput): string {
  const { ideasText, maxRuns = 50, notesText, state } = input
  const sections = [
    "# Autoresearch Compaction Summary",
    "The persisted autoresearch state below is the source of truth after context loss.",
    sessionSection(state),
    rulesSection(notesText),
    ideasSection(ideasText),
    recentRunsSection(state, maxRuns),
    notesSection(state),
    nextStepSection(state),
  ].filter(Boolean)

  return sections.join("\n\n")
}

export function recentRunsSection(state: AutoresearchState, maxRuns = 50): string {
  const runs = maxRuns < 0 ? state.runs : state.runs.slice(-maxRuns)
  if (runs.length === 0) return "## Recent Runs\n- No experiment runs have been recorded yet."

  const baselineRun = findBaselineRun(state)
  const bestRun = findBestKeptRun(state)
  const baselineMetric = baselineRun ? findPrimaryMetric(baselineRun.metrics, state.config?.primaryMetric) : undefined
  const bestMetric = bestRun ? findPrimaryMetric(bestRun.metrics, state.config?.primaryMetric) : undefined
  const confidence = computeSegmentConfidence(currentSegmentRuns(state, -1), state.config?.primaryMetric)
  const confidenceSummary = formatConfidenceSummary(confidence)

  return [
    `## Recent Runs (last ${runs.length})`,
    `- Current segment: ${currentSegment(state)}`,
    baselineMetric
      ? `- Baseline: #${baselineRun?.iteration} ${baselineMetric.name}=${baselineMetric.value}${baselineMetric.unit ?? ""}`
      : "- Baseline: not established yet.",
    formatBestRunSummary(bestRun, bestMetric, baselineMetric),
    `- Confidence: ${confidenceSummary}`,
    ...runs.map((run) => formatRunSummary(run, state)),
  ].join("\n")
}

export function nextStepSection(state: AutoresearchState): string {
  const lastRun = state.runs.at(-1)
  const lines = ["## Next Step"]

  if (!lastRun) {
    lines.push("- Establish the baseline by running the configured experiment once.")
    return lines.join("\n")
  }

  const nextHint = extractNextActionHint(lastRun.asi)
  if (nextHint) {
    lines.push(`- ${nextHint}`)
  } else if (lastRun.status === "checks_failed") {
    lines.push("- Fix the failing checks before accepting another run.")
  } else if (lastRun.decision === "keep") {
    lines.push("- Build on the kept run and probe for the next improvement.")
  } else if (lastRun.decision === "discard") {
    lines.push("- Revert the discarded change and try a smaller, more targeted iteration.")
  } else if (lastRun.status === "crashed" || lastRun.status === "failed") {
    lines.push("- Stabilize the experiment command before continuing the loop.")
  } else {
    lines.push("- Decide whether to keep, discard, or refine the latest run.")
  }

  if (state.mode === "paused") lines.push("- Session is paused; resume only after the next hypothesis is ready.")
  if (state.mode === "off") lines.push("- Session mode is off; no automatic follow-up should be queued.")

  return lines.join("\n")
}

function formatRunSummary(run: ExperimentRun, state: AutoresearchState): string {
  const metrics = run.metrics.map((metric) => `${metric.name}=${metric.value}${metric.unit ?? ""}`).join(", ")
  const primaryMetric = findPrimaryMetric(run.metrics, state.config?.primaryMetric)
  const runSegment = run.segment ?? currentSegment(state)
  const baselineRun = findBaselineRun(state, runSegment)
  const baselineMetric = baselineRun ? findPrimaryMetric(baselineRun.metrics, state.config?.primaryMetric) : undefined
  const delta = formatRunDelta(primaryMetric, baselineMetric, baselineRun?.iteration)
  const status = run.decision ?? run.status
  const summary = run.summary ? ` | desc: ${collapseWhitespace(run.summary)}` : ""
  const confidence = run.confidence == null ? "" : `, conf=${run.confidence.toFixed(1)}x`
  const asi = formatAsiSummary(run.asi)
  const segment = runSegment !== currentSegment(state) ? `, segment=${runSegment}` : ""
  return `- #${run.iteration} ${status}${segment}${confidence}; metrics=[${metrics || "none"}]${delta}${summary}${asi}`
}

function rulesSection(notesText: string | undefined): string | undefined {
  if (!notesText?.trim()) return undefined
  return `## Experiment Rules (autoresearch.md)\n${notesText.trim()}`
}

function ideasSection(ideasText: string | undefined): string | undefined {
  if (!ideasText?.trim()) return undefined
  return `## Ideas Backlog (autoresearch.ideas.md)\n${ideasText.trim()}`
}

function notesSection(state: AutoresearchState): string | undefined {
  const notes = state.notes
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim())

  if (notes.length === 0) return undefined

  return ["## Notes", ...notes.map((value) => `- ${collapseWhitespace(value).slice(0, 240)}`)].join("\n")
}

function sessionSection(state: AutoresearchState): string {
  const name = extractAutoresearchSessionName(state)
  const objective = state.config?.objective ? `\n- Objective: ${state.config.objective}` : ""
  const primaryMetric = state.config?.primaryMetric ? `\n- Primary metric: ${state.config.primaryMetric}` : ""
  const benchmarkCommand = state.config?.benchmarkCommand ? `\n- Benchmark command: ${state.config.benchmarkCommand}` : ""

  return [
    "## Session",
    `- Name: ${name}`,
    `- Mode: ${state.mode}`,
    `- Current segment: ${currentSegment(state)}`,
    objective ? objective.slice(1) : undefined,
    primaryMetric ? primaryMetric.slice(1) : undefined,
    benchmarkCommand ? benchmarkCommand.slice(1) : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim()
}

function formatBestRunSummary(
  bestRun: ExperimentRun | undefined,
  bestMetric: ReturnType<typeof findPrimaryMetric>,
  baselineMetric: ReturnType<typeof findPrimaryMetric>,
): string {
  if (!bestRun || !bestMetric) return "- Best kept: none yet."
  if (!baselineMetric) return `- Best kept: #${bestRun.iteration} ${bestMetric.name}=${bestMetric.value}${bestMetric.unit ?? ""}`

  const relative = computeRelativeChange(
    baselineMetric.value,
    bestMetric.value,
    bestMetric.higherIsBetter ?? baselineMetric.higherIsBetter ?? true,
  )

  return `- Best kept: #${bestRun.iteration} ${bestMetric.name}=${bestMetric.value}${bestMetric.unit ?? ""} (${(relative * 100).toFixed(1)}%)`
}

function formatConfidenceSummary(confidence: number | null): string {
  if (confidence == null) return "not enough signal yet"
  if (confidence >= 2) return `${confidence.toFixed(1)}x noise floor — likely real`
  if (confidence >= 1) return `${confidence.toFixed(1)}x noise floor — above noise but marginal`
  return `${confidence.toFixed(1)}x noise floor — within noise`
}

function formatAsiSummary(asi: Record<string, unknown> | undefined): string {
  if (!asi || Object.keys(asi).length === 0) return ""

  const preferred = [
    ["hypothesis", "hyp"],
    ["next_action_hint", "next"],
    ["rollback_reason", "rollback"],
  ] as const
  const parts = preferred
    .map(([key, label]) => {
      const value = asi[key]
      if (typeof value !== "string" || !value.trim()) return undefined
      return `${label}: ${collapseWhitespace(value).slice(0, 80)}`
    })
    .filter((value): value is string => Boolean(value))

  if (parts.length === 0) {
    parts.push(...Object.entries(asi)
      .slice(0, 3)
      .map(([key, value]) => `${key}=${collapseWhitespace(formatAsiValue(value)).slice(0, 48)}`))
  }

  return parts.length > 0 ? ` | ${parts.join(" | ")}` : ""
}

function formatRunDelta(
  metric: ReturnType<typeof findPrimaryMetric>,
  baselineMetric: ReturnType<typeof findPrimaryMetric>,
  baselineIteration: number | undefined,
): string {
  if (!metric || !baselineMetric || metric.name !== baselineMetric.name || metric.value === baselineMetric.value) return ""
  const relative = computeRelativeChange(
    baselineMetric.value,
    metric.value,
    metric.higherIsBetter ?? baselineMetric.higherIsBetter ?? true,
  )
  const sign = relative > 0 ? "+" : ""
  return ` (${sign}${(relative * 100).toFixed(1)}% vs baseline${baselineIteration === undefined ? "" : ` #${baselineIteration}`})`
}

function formatAsiValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractNextActionHint(asi: Record<string, unknown> | undefined): string | undefined {
  if (!asi) return undefined

  const candidates = [asi.next_action_hint, asi.next, asi.follow_up]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return collapseWhitespace(candidate)
    }
  }

  return undefined
}
