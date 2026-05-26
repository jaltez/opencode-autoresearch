import path from "node:path"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import { currentSegment, findBaselineRun, findBestKeptRun } from "../core/jsonl"
import { findPrimaryMetric } from "../core/metrics"
import { autoresearchHookCandidates, resolveAutoresearchPaths } from "../core/paths"
import { buildHookStdin, createHookInvocation, DEFAULT_HOOK_TIMEOUT_MS } from "../core/hooks"
import type { AutoresearchState, ExperimentRun, HookInvocation } from "../core/types"

export async function executeAutoresearchHook(input: {
  abort: AbortSignal
  directory: string
  kind: HookInvocation["kind"]
  projectDir: string
  run?: ExperimentRun
  sessionId: string
  state: AutoresearchState
  stateSummary?: string
}): Promise<HookInvocation | undefined> {
  const scriptPath = await findExistingHookScript(input.directory, input.kind)
  if (!scriptPath) return undefined

  const result = await runHookCommand(input.directory, formatScriptCommand(input.directory, scriptPath), input.abort, {
    stdin: buildHookStdin({
      config: input.state.config,
      cwd: input.directory,
      event: input.kind,
      projectDir: input.projectDir,
      run: input.run,
      session: buildSessionSnapshot(input.state),
      sessionId: input.sessionId,
      stateSummary: input.stateSummary,
      workDir: input.directory,
    }),
    timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
  })

  return createHookInvocation({
    at: new Date().toISOString(),
    exitCode: result.exitCode,
    kind: input.kind,
    scriptPath,
    status: result.timedOut ? "timed_out" : result.exitCode === 0 ? "ok" : "failed",
    stderr: result.stderr,
    stdout: result.output,
  })
}

function buildSessionSnapshot(state: AutoresearchState) {
  const segment = currentSegment(state)
  const baselineRun = findBaselineRun(state, segment)
  const bestRun = findBestKeptRun(state, segment)
  const baselineMetric = baselineRun ? findPrimaryMetric(baselineRun.metrics, state.config?.primaryMetric) : undefined
  const bestMetric = bestRun ? findPrimaryMetric(bestRun.metrics, state.config?.primaryMetric) : undefined

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

function formatScriptCommand(cwd: string, scriptPath: string): string {
  const relative = path.relative(cwd, scriptPath) || path.basename(scriptPath)
  if (relative.startsWith("./") || relative.startsWith("../")) return shellQuote(relative)
  return shellQuote(`./${relative}`)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}

async function streamToText(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ""

  let result = ""
  stream.setEncoding("utf8")
  for await (const chunk of stream) {
    result += chunk
  }
  return result
}