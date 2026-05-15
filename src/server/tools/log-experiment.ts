import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { currentSegmentRuns } from "../../core/jsonl"
import { computeSegmentConfidence } from "../../core/metrics"
import type { ExperimentRun } from "../../core/types"
import { formatAutoresearchRecoveryMessage } from "../durability"
import { discardRunChanges, keepRunChanges, preservedArtifactPaths } from "../git"
import { appendJsonlEntry, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export const logExperimentTool = tool({
  description: "Record the keep or discard decision for an experiment run and apply the matching git action when possible.",
  args: {
    asi: tool.schema.string().optional(),
    decision: tool.schema.enum(["discard", "keep", "pending", "retry"]),
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

    if (run.status === "checks_failed" && args.decision === "keep") {
      return "Cannot keep a run whose checks failed."
    }

    const asi = parseAsi(args.asi, run.asi)

    const updatedRun: ExperimentRun = {
      ...run,
      asi,
      commit: undefined,
      decision: args.decision,
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
      await Effect.runPromise(context.ask({
        always: ["*"],
        metadata: { decision: args.decision, runId: updatedRun.id, tool: "Log autoresearch decision" },
        patterns: ["git commit"],
        permission: "bash",
      }))
      const kept = await keepRunChanges(session.paths.directory, updatedRun, preservedArtifactPaths(session.paths.directory))
      updatedRun.commit = kept.commit
      gitOutput = kept.output
      runtimeStore.resetLoop(context.sessionID)
    }

    if (args.decision === "discard") {
      await Effect.runPromise(context.ask({
        always: ["*"],
        metadata: { decision: args.decision, runId: updatedRun.id, tool: "Log autoresearch decision" },
        patterns: ["git restore"],
        permission: "bash",
      }))
      gitOutput = await discardRunChanges(session.paths.directory, updatedRun, preservedArtifactPaths(session.paths.directory))
      runtimeStore.queueAutoResume(context.sessionID, `retry:${updatedRun.id}`)
    }

    if (args.decision === "retry") {
      runtimeStore.queueAutoResume(context.sessionID, `retry:${updatedRun.id}`)
    }

    if (args.decision === "pending") {
      runtimeStore.queueAutoResume(context.sessionID, `pending:${updatedRun.id}`)
    }

    await appendJsonlEntry(session.paths, {
      at: new Date().toISOString(),
      run: updatedRun,
      type: "run",
    })

  const nextSession = await loadAutoresearchSession(context.directory, workDir)
    await writeStateSnapshot(nextSession.paths, nextSession.state)

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

function formatConfidenceOutput(confidence: number | null | undefined): string | undefined {
  if (confidence == null) return undefined
  if (confidence >= 2) return `Confidence: ${confidence.toFixed(1)}x noise floor — improvement is likely real.`
  if (confidence >= 1) return `Confidence: ${confidence.toFixed(1)}x noise floor — improvement is above noise but still marginal.`
  return `Confidence: ${confidence.toFixed(1)}x noise floor — this result is still within noise; rerun if you need to confirm it.`
}

function formatAsiOutput(asi: Record<string, unknown> | undefined): string | undefined {
  if (!asi || Object.keys(asi).length === 0) return undefined

  const parts = Object.entries(asi)
    .map(([key, value]) => `${key}=${stringifyAsiValue(value)}`)
  return `ASI: ${parts.join(" | ")}`
}

function parseAsi(value: string | undefined, existing: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return existing

  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        ...(existing ?? {}),
        ...(parsed as Record<string, unknown>),
      }
    }
  } catch {
    // Fall back to a plain string note.
  }

  return {
    ...(existing ?? {}),
    note: value.trim(),
  }
}

function stringifyAsiValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
