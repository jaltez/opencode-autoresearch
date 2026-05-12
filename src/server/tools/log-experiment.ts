import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import type { ExperimentRun } from "../../core/types"
import { discardRunChanges, keepRunChanges, preservedArtifactPaths } from "../git"
import { appendJsonlEntry, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export const logExperimentTool = tool({
  description: "Record the keep or discard decision for an experiment run and apply the matching git action when possible.",
  args: {
    decision: tool.schema.enum(["discard", "keep", "pending", "retry"]),
    runId: tool.schema.string().optional(),
    summary: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Log autoresearch decision" })

    const session = await loadAutoresearchSession(context.directory, args.workDir)
    const run = args.runId
      ? session.state.runs.find((item) => item.id === args.runId)
      : session.state.runs.at(-1)

    if (!run) {
      return "No recorded run is available to log."
    }

    if (run.status === "checks_failed" && args.decision === "keep") {
      return "Cannot keep a run whose checks failed."
    }

    const updatedRun: ExperimentRun = {
      ...run,
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

    const nextSession = await loadAutoresearchSession(context.directory, args.workDir)
    await writeStateSnapshot(nextSession.paths, nextSession.state)

    return {
      metadata: {
        commit: updatedRun.commit,
        decision: updatedRun.decision,
        runId: updatedRun.id,
        status: updatedRun.status,
      },
      output: [`Updated run #${updatedRun.iteration} to ${updatedRun.decision}.`, gitOutput].join("\n"),
    }
  },
})
