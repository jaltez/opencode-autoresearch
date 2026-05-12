import { registerSecondaryMetrics } from "./metrics"
import {
  createEmptyState,
  type AutoresearchJsonlEntry,
  type AutoresearchState,
  type ExperimentConfig,
  type ExperimentRun,
  type HookInvocation,
} from "./types"

export function serializeJsonlEntry(entry: AutoresearchJsonlEntry): string {
  return `${JSON.stringify(entry)}\n`
}

export function parseJsonlLine(line: string): AutoresearchJsonlEntry | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string" || typeof parsed.at !== "string") {
    return undefined
  }

  switch (parsed.type) {
    case "session":
      if (!isExperimentConfig(parsed.config)) return undefined
      return {
        at: parsed.at,
        config: parsed.config,
        mode: parseMode(parsed.mode),
        type: "session",
      }
    case "mode": {
      const mode = parseMode(parsed.mode)
      if (!mode) return undefined
      return {
        at: parsed.at,
        mode,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        type: "mode",
      }
    }
    case "note":
      if (typeof parsed.markdown !== "string") return undefined
      return {
        at: parsed.at,
        markdown: parsed.markdown,
        type: "note",
      }
    case "run":
      if (!isExperimentRun(parsed.run)) return undefined
      return {
        at: parsed.at,
        run: parsed.run,
        type: "run",
      }
    case "hook":
      if (!isHookInvocation(parsed.hook)) return undefined
      return {
        at: parsed.at,
        hook: parsed.hook,
        type: "hook",
      }
    default:
      return undefined
  }
}

export function reconstructJsonlState(content: string): AutoresearchState {
  const state = createEmptyState()

  for (const line of content.split(/\r?\n/u)) {
    const entry = parseJsonlLine(line)
    if (!entry) continue

    state.lastUpdatedAt = entry.at

    switch (entry.type) {
      case "session":
        state.config = entry.config
        state.mode = entry.mode ?? state.mode
        break
      case "mode":
        state.mode = entry.mode
        break
      case "note":
        state.notes.push(entry.markdown)
        break
      case "hook":
        state.hooks.push(entry.hook)
        break
      case "run":
        upsertRun(state, entry.run)
        state.secondaryMetrics = registerSecondaryMetrics(state.secondaryMetrics, entry.run.metrics)
        break
    }
  }

  return state
}

export function extractAutoresearchSessionName(state: AutoresearchState, fallback = "autoresearch"): string {
  const configured = state.config?.name?.trim()
  if (configured) return configured

  const objective = state.config?.objective?.trim()
  if (objective) return objective.slice(0, 80)

  return fallback
}

export function currentSegmentRuns(state: AutoresearchState, limit = 5): ExperimentRun[] {
  return state.runs.slice(-limit)
}

function parseMode(value: unknown): AutoresearchState["mode"] | undefined {
  if (value === "active" || value === "off" || value === "paused") return value
  return undefined
}

function isExperimentConfig(value: unknown): value is ExperimentConfig {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.name === "string"
  )
}

function isExperimentRun(value: unknown): value is ExperimentRun {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    typeof value.id === "string" &&
    typeof value.iteration === "number" &&
    Array.isArray(value.metrics) &&
    typeof value.startedAt === "string" &&
    typeof value.status === "string"
  )
}

function isHookInvocation(value: unknown): value is HookInvocation {
  return (
    isRecord(value) &&
    typeof value.at === "string" &&
    (value.kind === "before" || value.kind === "after") &&
    typeof value.scriptPath === "string" &&
    (value.status === "failed" || value.status === "ok" || value.status === "skipped" || value.status === "timed_out")
  )
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function upsertRun(state: AutoresearchState, run: ExperimentRun): void {
  const index = state.runs.findIndex((existing) => existing.id === run.id)
  if (index === -1) {
    state.runs.push(run)
    return
  }

  state.runs[index] = run
}
