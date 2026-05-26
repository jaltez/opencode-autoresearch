import type { AutoresearchMode, ExperimentConfig, ExperimentRun, HookInvocation, MetricValue } from "./types"

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000
export const MAX_HOOK_OUTPUT_BYTES = 8 * 1024
const HOOK_TRUNCATION_MARKER = "\n...[truncated: hook output exceeded 8KB]"

export interface HookPayload {
  config?: ExperimentConfig
  cwd: string
  event: HookInvocation["kind"]
  projectDir: string
  run?: ExperimentRun
  session: {
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
  }
  sessionId: string
  stateSummary?: string
  workDir: string
}

export interface HookResponse {
  decision?: "continue" | "stop"
  message?: string
}

export function buildHookStdin(payload: HookPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function parseHookStdout(stdout: string): HookResponse {
  const trimmed = stdout.trim()
  if (!trimmed) return {}

  try {
    const parsed = JSON.parse(trimmed) as HookResponse
    if (typeof parsed === "object" && parsed) {
      return {
        decision: parsed.decision === "continue" || parsed.decision === "stop" ? parsed.decision : undefined,
        message: typeof parsed.message === "string" ? parsed.message : undefined,
      }
    }
  } catch {
    return { message: trimHookText(trimmed) }
  }

  return { message: trimHookText(trimmed) }
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
      // Try a shorter prefix until the byte sequence is complete.
    }
  }
  return bytes.slice(0, 0)
}

export function createHookInvocation(input: {
  at: string
  exitCode?: number
  kind: HookInvocation["kind"]
  scriptPath: string
  status: HookInvocation["status"]
  stderr?: string
  stdout?: string
}): HookInvocation {
  return {
    at: input.at,
    exitCode: input.exitCode,
    kind: input.kind,
    message: parseHookStdout(input.stdout ?? "").message,
    scriptPath: input.scriptPath,
    status: input.status,
    stderr: input.stderr ? trimHookText(input.stderr) : undefined,
    stdout: input.stdout ? trimHookText(input.stdout) : undefined,
  }
}
