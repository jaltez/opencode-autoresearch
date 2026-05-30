import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import { currentSegment, findBaselineRun, findBestKeptRun } from "../core/jsonl"
import { findPrimaryMetric } from "../core/metrics"
import { autoresearchHookCandidates, resolveAutoresearchPaths } from "../core/paths"
import { buildHookStdin, createHookInvocation, DEFAULT_HOOK_TIMEOUT_MS, type HookSessionSnapshot } from "../core/hooks"
import type { AutoresearchState, ExperimentRun, HookInvocation } from "../core/types"
import { formatScriptCommand, streamToText } from "./shell"

export async function executeAutoresearchHook(input: {
  abort: AbortSignal
  directory: string
  kind: HookInvocation["kind"]
  lastRun?: ExperimentRun
  nextRun?: Partial<ExperimentRun>
  projectDir: string
  run?: ExperimentRun
  sessionId: string
  state: AutoresearchState
  stateSummary?: string
}): Promise<HookInvocation | undefined> {
  const scriptPath = await findExistingHookScript(input.directory, input.kind)
  if (!scriptPath) return undefined

  const lastRun = input.lastRun ?? input.run ?? input.state.runs.at(-1)
  const startedAtIso = new Date().toISOString()
  const startedAtMs = performance.now()
  const result = await runHookCommand(input.directory, formatScriptCommand(input.directory, scriptPath), input.abort, {
    stdin: buildHookStdin({
      config: input.state.config,
      cwd: input.directory,
      event: input.kind,
      last_run: lastRun,
      next_run: input.nextRun,
      projectDir: input.projectDir,
      run: input.lastRun ?? input.run,
      session: buildSessionSnapshot(input.state),
      sessionId: input.sessionId,
      stateSummary: input.stateSummary,
      workDir: input.directory,
    }),
    timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
  })

  return createHookInvocation({
    at: startedAtIso,
    durationMs: Math.max(0, Math.round(performance.now() - startedAtMs)),
    exitCode: result.exitCode,
    kind: input.kind,
    scriptPath,
    status: result.timedOut ? "timed_out" : result.exitCode === 0 ? "ok" : "failed",
    stderr: result.stderr,
    stdout: result.output,
    stdoutBytes: new TextEncoder().encode(result.output).byteLength,
    timedOut: result.timedOut,
  })
}

function buildSessionSnapshot(state: AutoresearchState): HookSessionSnapshot {
  const segment = currentSegment(state)
  const baselineRun = findBaselineRun(state, segment)
  const bestRun = findBestKeptRun(state, segment)
  const baselineMetric = baselineRun ? findPrimaryMetric(baselineRun.metrics, state.config?.primaryMetric) : undefined
  const bestMetric = bestRun ? findPrimaryMetric(bestRun.metrics, state.config?.primaryMetric) : undefined
  const direction = state.config?.metricDirection
    ?? (baselineMetric?.higherIsBetter === undefined
      ? undefined
      : baselineMetric.higherIsBetter
        ? "higher"
        : "lower")

  return {
    baselineMetric,
    baselineRun: baselineRun?.iteration,
    benchmarkCommand: state.config?.benchmarkCommand,
    bestMetric,
    bestRun: bestRun?.iteration,
    currentSegment: segment,
    mode: state.mode,
    name: state.config?.name,
    primaryMetric: state.config?.primaryMetric,
    runCount: state.runs.length,
    // Legacy compatibility aliases
    baseline_metric: baselineMetric?.value,
    best_metric: bestMetric?.value,
    direction,
    goal: state.config?.objective,
    metric_name: state.config?.primaryMetric,
    metric_unit: state.config?.metricUnit ?? baselineMetric?.unit,
    run_count: state.runs.length,
  }
}

async function findExistingHookScript(directory: string, kind: HookInvocation["kind"]): Promise<string | undefined> {
  const paths = resolveAutoresearchPaths(directory)
  for (const candidate of autoresearchHookCandidates(paths, kind)) {
    if (await isExecutableFile(candidate)) return candidate
  }
  return undefined
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const entry = await stat(filePath)
    if (!entry.isFile()) return false
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function runHookCommand(
  cwd: string,
  command: string,
  abort: AbortSignal,
  options: { stdin: string; timeoutMs: number },
): Promise<{ exitCode: number; output: string; stderr: string; timedOut: boolean }> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(abort.reason)
  abort.addEventListener("abort", onAbort, { once: true })
  const timeout = setTimeout(() => {
    controller.abort("timeout")
  }, options.timeoutMs)

  try {
    const proc = spawn("/bin/bash", ["-lc", command], {
      cwd,
      signal: controller.signal,
      stdio: "pipe",
    })

    const outputPromise = streamToText(proc.stdout)
    const stderrPromise = streamToText(proc.stderr)

    proc.stdin?.write(options.stdin)
    proc.stdin?.end()

    const exitCode = await new Promise<number>((resolve) => {
      proc.once("close", (code) => resolve(code ?? 0))
      proc.once("error", () => resolve(124))
    })
    const [output, stderr] = await Promise.all([outputPromise, stderrPromise])

    return {
      exitCode,
      output,
      stderr,
      timedOut: controller.signal.aborted,
    }
  } finally {
    abort.removeEventListener("abort", onAbort)
    clearTimeout(timeout)
  }
}