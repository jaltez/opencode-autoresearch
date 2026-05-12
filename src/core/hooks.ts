import type { ExperimentConfig, ExperimentRun, HookInvocation } from "./types"

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000
export const MAX_HOOK_OUTPUT_BYTES = 32 * 1024

export interface HookPayload {
  config: ExperimentConfig
  projectDir: string
  run?: ExperimentRun
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
  const trimmed = encoded.slice(0, maxBytes)
  return `${new TextDecoder().decode(trimmed)}\n...[truncated]`
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
