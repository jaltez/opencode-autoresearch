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
  const { ideasText, maxRuns = 5, notesText, state } = input
  const sections = [
    "# Autoresearch",
    sessionSection(state),
    recentRunsSection(state, maxRuns),
    notesSection(notesText, ideasText, state),
    nextStepSection(state),
  ].filter(Boolean)

  return sections.join("\n\n")
}

export function recentRunsSection(state: AutoresearchState, maxRuns = 5): string {
  const runs = currentSegmentRuns(state, maxRuns)
  if (runs.length === 0) return "## Recent Runs\n- No experiment runs have been recorded yet."

  const baselineRun = findBaselineRun(state)
  const bestRun = findBestKeptRun(state)
  const baselineMetric = baselineRun ? findPrimaryMetric(baselineRun.metrics, state.config?.primaryMetric) : undefined
  const bestMetric = bestRun ? findPrimaryMetric(bestRun.metrics, state.config?.primaryMetric) : undefined
  const confidence = computeSegmentConfidence(currentSegmentRuns(state, -1), state.config?.primaryMetric)
  const confidenceSummary = formatConfidenceSummary(confidence)

  return [
    "## Recent Runs",
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
  const summary = run.summary ? ` - ${run.summary}` : ""
  const decision = run.decision ? `, decision=${run.decision}` : ""
  const confidence = run.confidence == null ? "" : `, conf=${run.confidence.toFixed(1)}x`
  const asi = formatAsiSummary(run.asi)
  const segment = run.segment && run.segment !== currentSegment(state) ? `, segment=${run.segment}` : ""
  return `- #${run.iteration}: status=${run.status}${decision}${segment}${confidence}; metrics=[${metrics || "none"}]${summary}${asi}`
}

function notesSection(notesText: string | undefined, ideasText: string | undefined, state: AutoresearchState): string {
  const notes = [notesText, ideasText, state.notes.at(-1)]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.trim())

  if (notes.length === 0) return "## Notes\n- No notes or ideas captured yet."

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
  return value.replace(/\s+/gu, " ")
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

  const parts = Object.entries(asi)
    .slice(0, 3)
    .map(([key, value]) => `${key}=${collapseWhitespace(formatAsiValue(value)).slice(0, 48)}`)

  return parts.length > 0 ? `; asi=[${parts.join(" | ")}]` : ""
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
