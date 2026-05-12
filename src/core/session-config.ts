import { readFile } from "node:fs/promises"
import type { ResolvedAutoresearchPaths } from "./paths"
import type { AutoresearchState, ExperimentConfig } from "./types"

export interface AutoresearchFileConfig {
  maxIterations?: number
  workingDir?: string
}

export const AUTORESEARCH_CANONICAL_COMMAND = "./autoresearch.sh"

export async function loadAutoresearchFileConfig(paths: ResolvedAutoresearchPaths): Promise<AutoresearchFileConfig | undefined> {
  try {
    const text = await readFile(paths.config, "utf8")
    return parseAutoresearchFileConfig(text)
  } catch {
    return undefined
  }
}

export async function normalizeAutoresearchState(
  paths: ResolvedAutoresearchPaths,
  state: AutoresearchState,
): Promise<AutoresearchState> {
  const [fileConfig, hasScript] = await Promise.all([
    loadAutoresearchFileConfig(paths),
    Bun.file(paths.script).exists(),
  ])

  const currentSegment = inferCurrentSegment(state)
  const normalizedRuns = state.runs.map((run) => ({
    ...run,
    segment: run.segment ?? (currentSegment > 0 ? currentSegment : 1),
  }))

  if (!state.config && !fileConfig) {
    return {
      ...state,
      currentSegment,
      runs: normalizedRuns,
    }
  }

  return {
    ...state,
    currentSegment,
    config: normalizeExperimentConfig(state.config, { fileConfig, hasScript }),
    runs: normalizedRuns,
  }
}

export function isAutoresearchScriptCommand(command: string, scriptPath?: string): boolean {
  let normalized = command.trim()
  if (!normalized) return false

  normalized = normalized.replace(/^(?:\w+=\S*\s+)+/u, "")

  let previous = ""
  while (previous !== normalized) {
    previous = normalized
    normalized = normalized.replace(/^(?:env|time|nice|nohup)(?:\s+-\S+(?:\s+\d+)?)?\s+/u, "")
  }

  if (/^(?:bash|sh|source)\s+/u.test(normalized)) {
    normalized = normalized.replace(/^(?:bash|sh|source)\s+(?:-\w+\s+)*/u, "")
  }

  const firstToken = normalized.split(/\s+/u)[0] ?? ""
  const normalizedToken = firstToken.replaceAll("\\", "/")
  if (normalizedToken === "autoresearch.sh" || normalizedToken === "./autoresearch.sh") return true
  if (scriptPath) {
    return normalizedToken === scriptPath.replaceAll("\\", "/")
  }
  return false
}

export function normalizeExperimentConfig(
  config: ExperimentConfig | undefined,
  input: { fileConfig?: AutoresearchFileConfig; hasScript: boolean },
): ExperimentConfig | undefined {
  if (!config && !input.fileConfig) return undefined
  if (!config) return undefined

  const benchmarkCommand = config.benchmarkCommand
    ?? (!isAutoresearchScriptCommand(config.command) ? config.command : undefined)

  return {
    ...config,
    benchmarkCommand,
    command: input.hasScript ? AUTORESEARCH_CANONICAL_COMMAND : config.command,
    maxIterations: input.fileConfig?.maxIterations ?? config.maxIterations,
    workDir: input.fileConfig?.workingDir ?? config.workDir,
  }
}

function parseAutoresearchFileConfig(text: string): AutoresearchFileConfig | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined

    const config: AutoresearchFileConfig = {}
    if (typeof parsed.maxIterations === "number" && Number.isInteger(parsed.maxIterations) && parsed.maxIterations > 0) {
      config.maxIterations = parsed.maxIterations
    }
    if (typeof parsed.workingDir === "string" && parsed.workingDir.trim()) {
      config.workingDir = parsed.workingDir
    }

    return Object.keys(config).length > 0 ? config : undefined
  } catch {
    return undefined
  }
}

function inferCurrentSegment(state: AutoresearchState): number {
  const runSegments = state.runs.map((run) => run.segment ?? 0)
  return Math.max(state.currentSegment ?? 0, ...runSegments, state.config ? 1 : 0, state.runs.length > 0 ? 1 : 0)
}