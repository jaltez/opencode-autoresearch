import { currentSegmentRuns, extractAutoresearchSessionName } from "./jsonl"
import { computeConfidence } from "./metrics"
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

  const confidence = computeConfidence(
    runs
      .flatMap((run) => run.metrics)
      .map((metric) => metric.value),
  )

  return [
    "## Recent Runs",
    ...runs.map(formatRunSummary),
    `- Confidence: ${Math.round(confidence * 100)}%`,
  ].join("\n")
}

export function nextStepSection(state: AutoresearchState): string {
  const lastRun = state.runs.at(-1)
  const lines = ["## Next Step"]

  if (!lastRun) {
    lines.push("- Establish the baseline by running the configured experiment once.")
    return lines.join("\n")
  }

  if (lastRun.status === "checks_failed") {
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

function formatRunSummary(run: ExperimentRun): string {
  const metrics = run.metrics.map((metric) => `${metric.name}=${metric.value}${metric.unit ?? ""}`).join(", ")
  const summary = run.summary ? ` - ${run.summary}` : ""
  const decision = run.decision ? `, decision=${run.decision}` : ""
  return `- #${run.iteration}: status=${run.status}${decision}; metrics=[${metrics || "none"}]${summary}`
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

  return [
    "## Session",
    `- Name: ${name}`,
    `- Mode: ${state.mode}`,
    objective ? objective.slice(1) : undefined,
    primaryMetric ? primaryMetric.slice(1) : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ")
}
