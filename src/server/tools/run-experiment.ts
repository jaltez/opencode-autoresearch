import path from "node:path"
import { spawn } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { parseMetricLines } from "../../core/metrics"
import { createHookInvocation, DEFAULT_HOOK_TIMEOUT_MS } from "../../core/hooks"
import type { ExperimentCheckResult, ExperimentRun, HookInvocation, RunStatus } from "../../core/types"
import { preservedArtifactPaths, captureGitChanges } from "../git"
import { appendJsonlEntry, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export function createRunExperimentTool() {
  return tool({
    description: "Run the configured experiment command, parse METRIC lines, and record the result in autoresearch.jsonl.",
    args: {
      command: tool.schema.string().optional(),
      summary: tool.schema.string().optional(),
      workDir: tool.schema.string().optional(),
    },
    async execute(args, context) {
      context.metadata({ title: "Run autoresearch experiment" })

      const session = await loadAutoresearchSession(context.directory, args.workDir)
      const config = session.state.config
      if (!config) {
        return "No autoresearch session is configured yet. Run init_experiment first."
      }

      const command = args.command ?? config.command
      await Effect.runPromise(context.ask({
        always: ["*"],
        metadata: { command, tool: "Run autoresearch experiment" },
        patterns: [command],
        permission: "bash",
      }))

      runtimeStore.markAutomated(context.sessionID, session.paths.directory)

      const iteration = session.state.runs.length + 1
      const startedAt = new Date().toISOString()
      const beforeHook = await executeHookIfPresent({
        context,
        directory: session.paths.directory,
        fileName: "before.sh",
        kind: "before",
        stateSummary: args.summary,
      })
      if (beforeHook) {
        await appendJsonlEntry(session.paths, { at: beforeHook.at, hook: beforeHook, type: "hook" })
      }

      const commandResult = await runShellCommand(session.paths.directory, command, context.abort)
      const metrics = parseMetricLines(commandResult.output)
      const checks = await runChecks(session.paths.directory, config.checks ?? [], context.abort)
      const hasFailedCheck = checks.some((item) => !item.passed)
      const status: RunStatus = hasFailedCheck ? "checks_failed" : commandResult.exitCode === 0 ? "completed" : "failed"
      const changes = await captureGitChanges(session.paths.directory, preservedArtifactPaths(session.paths.directory))

      const run: ExperimentRun = {
        changes,
        checks,
        command,
        decision: "pending",
        endedAt: new Date().toISOString(),
        error: commandResult.exitCode === 0 ? undefined : commandResult.stderr.trim() || commandResult.output.trim() || undefined,
        exitCode: commandResult.exitCode,
        id: crypto.randomUUID(),
        iteration,
        metrics,
        output: truncateOutput(commandResult.outputWithStderr),
        startedAt,
        status,
        summary: args.summary,
      }

      await appendJsonlEntry(session.paths, { at: run.endedAt ?? new Date().toISOString(), run, type: "run" })
      const afterHook = await executeHookIfPresent({
        context,
        directory: session.paths.directory,
        fileName: "after.sh",
        kind: "after",
        run,
        stateSummary: args.summary,
      })
      if (afterHook) {
        await appendJsonlEntry(session.paths, { at: afterHook.at, hook: afterHook, type: "hook" })
      }

      const nextSession = await loadAutoresearchSession(context.directory, args.workDir)
      await writeStateSnapshot(nextSession.paths, nextSession.state)

      const reachedMaxIterations = config.maxIterations ? iteration >= config.maxIterations : false
      if (nextSession.state.mode === "active" && !reachedMaxIterations) {
        runtimeStore.queueAutoResume(context.sessionID, `run:${run.id}`)
      } else {
        runtimeStore.resetLoop(context.sessionID)
      }

      return {
        metadata: {
          changes,
          exitCode: commandResult.exitCode,
          iteration,
          metrics,
          runID: run.id,
          status,
        },
        output: [
          `Recorded run #${iteration} with status ${status}.`,
          metrics.length > 0
            ? `Metrics: ${metrics.map((metric) => `${metric.name}=${metric.value}${metric.unit ?? ""}`).join(", ")}`
            : "Metrics: none",
          checks.length > 0
            ? `Checks: ${checks.map((item) => `${item.command}=${item.passed ? "pass" : "fail"}`).join(", ")}`
            : "Checks: none",
          `Workdir: ${path.relative(context.directory, session.paths.directory) || "."}`,
        ].join("\n"),
      }
    },
  })
}

async function runChecks(cwd: string, checks: readonly string[], signal: AbortSignal): Promise<ExperimentCheckResult[]> {
  const results: ExperimentCheckResult[] = []
  for (const command of checks) {
    const result = await runShellCommand(cwd, command, signal)
    results.push({
      command,
      exitCode: result.exitCode,
      output: truncateOutput(result.outputWithStderr),
      passed: result.exitCode === 0,
    })
  }
  return results
}

async function executeHookIfPresent(input: {
  context: Parameters<ReturnType<typeof createRunExperimentTool>["execute"]>[1]
  directory: string
  fileName: string
  kind: HookInvocation["kind"]
  run?: ExperimentRun
  stateSummary?: string
}): Promise<HookInvocation | undefined> {
  const scriptPath = path.join(input.directory, input.fileName)
  if (!(await Bun.file(scriptPath).exists())) return undefined

  const payload = {
    projectDir: input.context.directory,
    run: input.run,
    sessionId: input.context.sessionID,
    stateSummary: input.stateSummary,
    workDir: input.directory,
  }

  const result = await runShellCommand(input.directory, scriptPath, input.context.abort, {
    stdin: `${JSON.stringify(payload, null, 2)}\n`,
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

async function runShellCommand(
  cwd: string,
  command: string,
  abort: AbortSignal,
  options?: { stdin?: string; timeoutMs?: number },
): Promise<{ exitCode: number; output: string; outputWithStderr: string; stderr: string; timedOut: boolean }> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(abort.reason)
  abort.addEventListener("abort", onAbort, { once: true })
  const timeout =
    options?.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
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

    if (options?.stdin && proc.stdin) {
      proc.stdin.write(options.stdin)
    }
    proc.stdin?.end()

    const exitCode = await new Promise<number>((resolve) => {
      proc.once("close", (code) => resolve(code ?? 0))
      proc.once("error", () => resolve(124))
    })
    const [output, stderr] = await Promise.all([outputPromise, stderrPromise])

    const outputWithStderr = [output, stderr].filter(Boolean).join(output && stderr ? "\n" : "")

    return {
      exitCode,
      output,
      outputWithStderr,
      stderr,
      timedOut: controller.signal.aborted && options?.timeoutMs !== undefined,
    }
  } finally {
    abort.removeEventListener("abort", onAbort)
    if (timeout) clearTimeout(timeout)
  }
}

function truncateOutput(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated]`
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
