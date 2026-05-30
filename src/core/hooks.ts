import type { AutoresearchMode, ExperimentConfig, ExperimentRun, HookInvocation, MetricValue } from "./types"

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000
export const MAX_HOOK_OUTPUT_BYTES = 8 * 1024
const HOOK_TRUNCATION_MARKER = "\n...[truncated: hook output exceeded 8KB]"

/** Session snapshot sent to hooks, with legacy snake_case aliases for compatibility. */
export interface HookSessionSnapshot {
  baselineMetric?: MetricValue
  baselineRun?: number
  benchmarkCommand?: string
  bestMetric?: MetricValue
  bestRun?: number
  currentSegment: number
  mode: AutoresearchMode
  name?: string
  primaryMetric?: string
  runCount: number
  // Legacy compatibility aliases
  baseline_metric?: number
  best_metric?: number
  direction?: "higher" | "lower"
  goal?: string
  metric_name?: string
  metric_unit?: string
  run_count: number
}

export interface HookPayload {
  config?: ExperimentConfig
  cwd: string
  event: HookInvocation["kind"]
  last_run?: ExperimentRun
  next_run?: Partial<ExperimentRun>
  projectDir: string
  run?: ExperimentRun
  session: HookSessionSnapshot
  sessionId: string
  stateSummary?: string
  workDir: string
}

export interface HookResponse {
  decision?: "continue" | "stop"
  message?: string
}

export function buildHookStdin(payload: HookPayload): string {
  return `${JSON.stringify(payload)}\n`
}

export function parseHookStdout(stdout: string): HookResponse {
  const trimmed = stdout.trim()
  if (!trimmed) return {}

  const candidate = parseJsonObject(trimmed)
  if (!candidate) {
    return { message: trimHookText(trimmed) }
  }

  const decision = candidate.decision
  const message = candidate.message
  if (decision === undefined && message === undefined) {
    return { message: trimHookText(trimmed) }
  }

  return {
    decision: decision === "continue" || decision === "stop" ? decision : undefined,
    message: typeof message === "string" ? message : undefined,
  }
}

export function trimHookText(text: string, maxBytes = MAX_HOOK_OUTPUT_BYTES): string {
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength <= maxBytes) return text
  const trimmed = completeUtf8Prefix(encoded.slice(0, maxBytes))
  return `${new TextDecoder().decode(trimmed)}${HOOK_TRUNCATION_MARKER}`
}

function completeUtf8Prefix(bytes: Uint8Array): Uint8Array {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  for (let end = bytes.byteLength; end > 0; end -= 1) {
    const candidate = bytes.slice(0, end)
    try {
      decoder.decode(candidate)
      return candidate
    } catch {
    }
  }
  return bytes.slice(0, 0)
}

export function createHookInvocation(input: {
  at: string
  durationMs?: number
  exitCode?: number
  kind: HookInvocation["kind"]
  scriptPath: string
  status: HookInvocation["status"]
  stderr?: string
  stdout?: string
  stdoutBytes?: number
  timedOut?: boolean
}): HookInvocation {
  return {
    at: input.at,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    kind: input.kind,
    message: parseHookStdout(input.stdout ?? "").message,
    scriptPath: input.scriptPath,
    status: input.status,
    stderr: input.stderr ? trimHookText(input.stderr) : undefined,
    stdout: input.stdout ? trimHookText(input.stdout) : undefined,
    stdoutBytes: input.stdoutBytes,
    timedOut: input.timedOut,
  }
}

/** Drop raw hook I/O before writing a hook invocation to JSONL. */
export function toJsonlHookInvocation(hook: HookInvocation): HookInvocation {
  return {
    at: hook.at,
    durationMs: hook.durationMs,
    exitCode: hook.exitCode,
    kind: hook.kind,
    message: hook.message,
    scriptPath: hook.scriptPath,
    status: hook.status,
    stdoutBytes: hook.stdoutBytes,
    timedOut: hook.timedOut,
  }
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return undefined
  }

  return undefined
}

