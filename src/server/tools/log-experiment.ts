import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { currentSegmentRuns } from "../../core/jsonl"
import { computeSegmentConfidence, parseMetricLine } from "../../core/metrics"
import type { ExperimentRun, MetricValue, SecondaryMetricRegistry } from "../../core/types"
import { formatAutoresearchRecoveryMessage } from "../durability"
import { discardRunChanges, keepRunChanges, preservedArtifactPaths } from "../git"
import { executeAutoresearchHook } from "../hook-runner"
import { appendJsonlEntry, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"
import {
  describeMetricDrift,
  formatAsiOutput,
  formatConfidenceOutput,
  mergeOverrideMetrics,
  parseAsi,
} from "./experiment-helpers"

export const logExperimentTool = tool({
  description: "Record the keep or discard decision for an experiment run and apply the matching git action when possible.",
  args: {
    asi: tool.schema.string().optional(),
    commit: tool.schema.string().optional(),
    decision: tool.schema.enum(["discard", "keep", "pending", "retry"]),
    force: tool.schema.boolean().optional(),
    metric: tool.schema.string().optional(),
    metrics: tool.schema.array(tool.schema.string()).optional(),
    runId: tool.schema.string().optional(),
    summary: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Log autoresearch decision" })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    const recoveryMessage = formatAutoresearchRecoveryMessage(session.durability, "logging a run decision")
    if (recoveryMessage) {
      return recoveryMessage
    }

    const run = args.runId
      ? session.state.runs.find((item) => item.id === args.runId)
      : session.state.runs.at(-1)

    if (!run) {
      return "No recorded run is available to log."
    }

    if (run.status === "checks_failed" && args.decision === "keep" && !args.force) {
      return "Cannot keep a run whose checks failed. Re-run with force=true to override."
    }

    const asi = parseAsi(args.asi, run.asi)
    const mergedMetrics = mergeOverrideMetrics(run.metrics, args.metric, args.metrics)

    const hasMetricOverride = Boolean(args.metric) || (args.metrics?.length ?? 0) > 0
    if (hasMetricOverride && !args.force) {
      const drift = describeMetricDrift(session.state.secondaryMetrics, mergedMetrics)
      if (drift) {
        return `${drift} Pass force=true to override.`
      }
    }

    const updatedRun: ExperimentRun = {
      ...run,
      asi,
      commit: undefined,
      decision: args.decision,
      metrics: mergedMetrics,
      status:
        args.decision === "keep"
          ? "kept"
          : args.decision === "discard"
            ? "discarded"
            : run.status,
      summary: args.summary ?? run.summary,
    }

    const nextRuns = session.state.runs.map((item) => item.id === updatedRun.id ? updatedRun : item)
    const confidence = computeSegmentConfidence(
      currentSegmentRuns({ ...session.state, runs: nextRuns }, -1),
      session.state.config?.primaryMetric,
    )
    updatedRun.confidence = confidence

    let gitOutput = "No git action was required."
    if (args.decision === "keep") {
      if (args.commit) {
        updatedRun.commit = args.commit
        gitOutput = `Recorded externally produced commit ${args.commit}.`
      } else {
        await Effect.runPromise(context.ask({
          always: ["*"],
          metadata: { decision: args.decision, runId: updatedRun.id, tool: "Log autoresearch decision" },
          patterns: ["git commit"],
          permission: "bash",
        }))
        const kept = await keepRunChanges(session.paths.directory, updatedRun, preservedArtifactPaths(session.paths.directory))
        if (kept.status === "failed") {
          return [
            `Unable to keep run #${updatedRun.iteration} because git commit failed.`,
            kept.output,
            "The run remains pending; fix the git issue and retry log_experiment with decision=keep.",
          ].join("\n")
        }
        updatedRun.commit = kept.commit
        gitOutput = kept.output
      }
    }

    if (args.decision === "discard") {
      await Effect.runPromise(context.ask({
        always: ["*"],
        metadata: { decision: args.decision, runId: updatedRun.id, tool: "Log autoresearch decision" },
        patterns: ["git restore"],
        permission: "bash",
      }))
      gitOutput = await discardRunChanges(session.paths.directory, updatedRun, preservedArtifactPaths(session.paths.directory))
    }

    await appendJsonlEntry(session.paths, {
      at: new Date().toISOString(),
      run: updatedRun,
      type: "run",
    })

    const nextSession = await loadAutoresearchSession(context.directory, workDir)
    const afterHook = await executeAutoresearchHook({
      abort: context.abort,
      directory: nextSession.paths.directory,
      kind: "after",
      lastRun: updatedRun,
      projectDir: context.directory,
      run: updatedRun,
      sessionId: context.sessionID,
      state: nextSession.state,
      stateSummary: args.summary ?? updatedRun.summary,
    })
    if (afterHook) {
      await appendJsonlEntry(nextSession.paths, { at: afterHook.at, hook: afterHook, type: "hook" })
    }

    const finalSession = afterHook ? await loadAutoresearchSession(context.directory, workDir) : nextSession
    await writeStateSnapshot(finalSession.paths, finalSession.state)
    queueNextLoopStep(context.sessionID, finalSession.state, updatedRun)

    return {
      metadata: {
        commit: updatedRun.commit,
        confidence: updatedRun.confidence,
        decision: updatedRun.decision,
        runId: updatedRun.id,
        status: updatedRun.status,
      },
      output: [
        `Updated run #${updatedRun.iteration} to ${updatedRun.decision}.`,
        gitOutput,
        formatAsiOutput(updatedRun.asi),
        formatConfidenceOutput(updatedRun.confidence),
      ].filter(Boolean).join("\n"),
    }
  },
})

function queueNextLoopStep(
  sessionId: string,
  state: Awaited<ReturnType<typeof loadAutoresearchSession>>["state"],
  run: ExperimentRun,
): void {
  if (state.mode !== "active") {
    runtimeStore.resetLoop(sessionId)
    return
  }

  const maxIterations = state.config?.maxIterations
  if (maxIterations && run.iteration >= maxIterations) {
    runtimeStore.resetLoop(sessionId)
    return
  }

  runtimeStore.queueAutoResume(sessionId, autoResumeReason(run))
}

function autoResumeReason(run: ExperimentRun): string {
  if (run.decision === "keep") return `next:${run.id}`
  if (run.decision === "discard" || run.decision === "retry") return `retry:${run.id}`
  return `pending:${run.id}`
}
