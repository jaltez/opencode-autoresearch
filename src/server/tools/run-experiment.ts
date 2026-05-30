import path from "node:path"
import { spawn } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { evaluateMetricCheckExpression, parseMetricCheckExpression } from "../../core/checks"
import { parseMetricLines, isPrimaryMetricFallback } from "../../core/metrics"
import { AUTORESEARCH_CANONICAL_COMMAND, isAutoresearchScriptCommand } from "../../core/session-config"
import type { ExperimentCheckResult, ExperimentConfig, ExperimentRun, MetricValue, RunStatus } from "../../core/types"
import { formatAutoresearchRecoveryMessage } from "../durability"
import { preservedArtifactPaths, captureGitChanges } from "../git"
import { executeAutoresearchHook } from "../hook-runner"
import { formatScriptCommand, streamToText } from "../shell"
import { appendJsonlEntry, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"
import { applyConfigMetricOverrides, buildLogExperimentSuggestion } from "./experiment-helpers"

const DEFAULT_EXPERIMENT_TIMEOUT_MS = 600_000
const DEFAULT_CHECKS_TIMEOUT_MS = 300_000

export function createRunExperimentTool() {
  return tool({
    description: "Run the configured experiment command, parse METRIC lines, and record the result in autoresearch.jsonl.",
    args: {
      command: tool.schema.string().optional(),
      checks_timeout_seconds: tool.schema.number().positive().optional(),
      summary: tool.schema.string().optional(),
      timeout_seconds: tool.schema.number().positive().optional(),
      workDir: tool.schema.string().optional(),
    },
    async execute(args, context) {
      context.metadata({ title: "Run autoresearch experiment" })

      const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
      const session = await loadAutoresearchSession(context.directory, workDir)
      const recoveryMessage = formatAutoresearchRecoveryMessage(session.durability, "running a new experiment")
      if (recoveryMessage) {
        return recoveryMessage
      }

      const config = session.state.config
      if (!config) {
        return "No autoresearch session is configured yet. Run init_experiment first."
      }

      const hasAutoresearchScript = await Bun.file(session.paths.script).exists()
      if (hasAutoresearchScript && args.command && !isAutoresearchScriptCommand(args.command, session.paths.script)) {
        return [
          "autoresearch.sh exists for this session, so run_experiment must use it as the canonical entrypoint.",
          `Use ${AUTORESEARCH_CANONICAL_COMMAND} instead of ${args.command}.`,
        ].join("\n")
      }

      const command = hasAutoresearchScript ? AUTORESEARCH_CANONICAL_COMMAND : (args.command ?? config.command)
      if (!hasAutoresearchScript && isAutoresearchScriptCommand(command, session.paths.script)) {
        return `Configured command ${command} expects autoresearch.sh, but ${path.relative(context.directory, session.paths.script) || "autoresearch.sh"} is missing.`
      }

      await Effect.runPromise(context.ask({
        always: ["*"],
        metadata: { command, tool: "Run autoresearch experiment" },
        patterns: [command],
        permission: "bash",
      }))

      runtimeStore.markAutomated(context.sessionID, session.paths.directory)
      const experimentTimeoutMs = secondsToMilliseconds(args.timeout_seconds, DEFAULT_EXPERIMENT_TIMEOUT_MS)
      const checksTimeoutMs = secondsToMilliseconds(args.checks_timeout_seconds, DEFAULT_CHECKS_TIMEOUT_MS)

      const iteration = session.state.runs.length + 1
      const startedAt = new Date().toISOString()
      const beforeHook = await executeHookIfPresent({
        context,
        directory: session.paths.directory,
        kind: "before",
        state: session.state,
        stateSummary: args.summary,
      })
      if (beforeHook) {
        await appendJsonlEntry(session.paths, { at: beforeHook.at, hook: beforeHook, type: "hook" })
      }

      const commandResult = await runShellCommand(session.paths.directory, command, context.abort, {
        timeoutMs: experimentTimeoutMs,
      })
      const metrics = applyConfigMetricOverrides(parseMetricLines(commandResult.output), config)
      const checks = commandResult.exitCode === 0
        ? await runChecks(session.paths.directory, session.paths.checks, config.checks ?? [], metrics, context.abort, checksTimeoutMs)
        : []
      const hasFailedCheck = checks.some((item) => !item.passed)
      const status: RunStatus = commandResult.timedOut
        ? "crashed"
        : hasFailedCheck
          ? "checks_failed"
          : commandResult.exitCode === 0
            ? "completed"
            : "failed"
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
        segment: session.state.currentSegment,
        startedAt,
        status,
        summary: args.summary,
      }

      await appendJsonlEntry(session.paths, { at: run.endedAt ?? new Date().toISOString(), run, type: "run" })
      const nextSession = await loadAutoresearchSession(context.directory, workDir)
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
          runId: run.id,
          status,
        },
        output: [
          `Recorded run #${iteration} with status ${status}.`,
          metrics.length > 0
            ? `Metrics: ${metrics.map((metric) => `${metric.name}=${metric.value}${metric.unit ?? ""}`).join(", ")}`
            : "Metrics: none",
          isPrimaryMetricFallback(metrics, config.primaryMetric)
            ? `Warning: configured primary metric \"${config.primaryMetric}\" was not emitted by this run; falling back to \"${metrics[0]?.name}\".`
            : "",
          checks.length > 0
            ? `Checks: ${checks.map((item) => `${item.command}=${item.passed ? "pass" : "fail"}`).join(", ")}`
            : "Checks: none",
          `Workdir: ${path.relative(context.directory, session.paths.directory) || "."}`,
          buildLogExperimentSuggestion(run, config.primaryMetric),
        ].filter(Boolean).join("\n"),
      }
    },
  })
}

async function runChecks(
  cwd: string,
  checksScriptPath: string,
  checks: readonly string[],
  metrics: readonly MetricValue[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ExperimentCheckResult[]> {
  const results: ExperimentCheckResult[] = []
  const hasChecksScript = await Bun.file(checksScriptPath).exists()

  if (hasChecksScript) {
    const command = formatScriptCommand(cwd, checksScriptPath)
    const result = await runShellCommand(cwd, command, signal, { timeoutMs })
    results.push({
      command,
      exitCode: result.exitCode,
      output: truncateOutput(result.outputWithStderr),
      passed: result.exitCode === 0,
    })
  }

  for (const command of checks) {
    const metricCheck = evaluateMetricCheckExpression(command, metrics)
    if (metricCheck) {
      results.push(metricCheck)
      continue
    }

    if (hasChecksScript && !parseMetricCheckExpression(command)) {
      continue
    }

    const result = await runShellCommand(cwd, command, signal, { timeoutMs })
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
  kind: "before"
  run?: ExperimentRun
  state: Awaited<ReturnType<typeof loadAutoresearchSession>>["state"]
  stateSummary?: string
}) {
  return executeAutoresearchHook({
    abort: input.context.abort,
    directory: input.directory,
    kind: input.kind,
    lastRun: input.state.runs.at(-1),
    nextRun: { iteration: input.state.runs.length + 1 },
    projectDir: input.context.directory,
    run: input.run,
    sessionId: input.context.sessionID,
    state: input.state,
    stateSummary: input.stateSummary,
  })
}

async function runShellCommand(
  cwd: string,
  command: string,
  abort: AbortSignal,
  options?: { stdin?: string; timeoutMs?: number },
): Promise<{ exitCode: number; output: string; outputWithStderr: string; stderr: string; timedOut: boolean }> {
  let timedOut = false
  let proc: ReturnType<typeof spawn> | undefined
  const kill = () => {
    if (!proc?.pid) return
    try {
      process.kill(-proc.pid, "SIGTERM")
    } catch {
      try {
        process.kill(proc.pid, "SIGTERM")
      } catch {
        // Process may have already exited.
      }
    }
  }
  const onAbort = () => kill()
  abort.addEventListener("abort", onAbort, { once: true })
  const timeout =
    options?.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          kill()
        }, options.timeoutMs)

  try {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      detached: true,
      stdio: "pipe",
    })
    proc = child
    if (abort.aborted) kill()

    const outputPromise = streamToText(child.stdout)
    const stderrPromise = streamToText(child.stderr)

    if (options?.stdin && child.stdin) {
      child.stdin.write(options.stdin)
    }
    child.stdin?.end()

    const exitCode = await new Promise<number>((resolve) => {
      child.once("close", (code) => resolve(timedOut ? 124 : code ?? 0))
      child.once("error", () => resolve(124))
    })
    const [output, stderr] = await Promise.all([outputPromise, stderrPromise])
    const timeoutMessage = timedOut ? `Command timed out after ${options?.timeoutMs ?? 0}ms.` : ""
    const combinedStderr = [stderr, timeoutMessage].filter(Boolean).join(stderr && timeoutMessage ? "\n" : "")

    const outputWithStderr = [output, combinedStderr].filter(Boolean).join(output && combinedStderr ? "\n" : "")

    return {
      exitCode,
      output,
      outputWithStderr,
      stderr: combinedStderr,
      timedOut,
    }
  } finally {
    abort.removeEventListener("abort", onAbort)
    if (timeout) clearTimeout(timeout)
  }
}

function secondsToMilliseconds(value: number | undefined, fallbackMs: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallbackMs
  return Math.max(1, Math.ceil(value * 1000))
}

function truncateOutput(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated]`
}
