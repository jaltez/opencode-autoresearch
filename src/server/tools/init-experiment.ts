import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { AUTORESEARCH_CANONICAL_COMMAND } from "../../core/session-config"
import {
  buildAutoresearchChecksScriptTemplate,
  buildAutoresearchConfigTemplate,
  buildAutoresearchIdeasTemplate,
  buildAutoresearchNotesTemplate,
  buildAutoresearchScriptTemplate,
} from "../scaffold"
import { appendJsonlEntry, ensureAutoresearchFiles, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export const initExperimentTool = tool({
  description: "Initialize or update the autoresearch session configuration for the current project.",
  args: {
    checks: tool.schema.array(tool.schema.string()).optional(),
    command: tool.schema.string().min(1),
    maxIterations: tool.schema.number().int().positive().optional(),
    metricDirection: tool.schema.enum(["higher", "lower"]).optional(),
    metricUnit: tool.schema.string().optional(),
    name: tool.schema.string().min(1),
    objective: tool.schema.string().optional(),
    primaryMetric: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Initialize autoresearch session" })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    const benchmarkCommand = args.command
    const config = {
      benchmarkCommand,
      checks: args.checks,
      command: AUTORESEARCH_CANONICAL_COMMAND,
      createdAt: session.state.config?.createdAt ?? new Date().toISOString(),
      maxIterations: args.maxIterations,
      metricDirection: args.metricDirection,
      metricUnit: args.metricUnit,
      name: args.name,
      objective: args.objective,
      primaryMetric: args.primaryMetric,
      workDir: args.workDir,
    }

    await ensureAutoresearchFiles(session.paths, {
      checksScript: buildAutoresearchChecksScriptTemplate(args.checks),
      config: buildAutoresearchConfigTemplate({
        maxIterations: args.maxIterations,
        workDir: args.workDir,
      }),
      ideas: buildAutoresearchIdeasTemplate(),
      notes: buildAutoresearchNotesTemplate({
        command: benchmarkCommand,
        name: args.name,
        objective: args.objective,
        primaryMetric: args.primaryMetric,
      }),
      script: buildAutoresearchScriptTemplate({
        command: benchmarkCommand,
        primaryMetric: args.primaryMetric,
      }),
    })

    await appendJsonlEntry(session.paths, {
      at: new Date().toISOString(),
      config,
      mode: "active",
      segment: (session.state.currentSegment ?? 0) + 1,
      type: "session",
    })

    const nextSession = await loadAutoresearchSession(context.directory, workDir)
    await writeStateSnapshot(nextSession.paths, nextSession.state)
    runtimeStore.activate(context.sessionID, nextSession.paths.directory)

    return {
      metadata: {
        name: args.name,
        primaryMetric: args.primaryMetric,
        workDir: nextSession.paths.directory,
      },
      output: [
        `Initialized autoresearch session \"${args.name}\".`,
        `Workdir: ${path.relative(context.directory, nextSession.paths.directory) || "."}`,
        `Command: ${AUTORESEARCH_CANONICAL_COMMAND} (benchmark: ${benchmarkCommand})`,
      ].join("\n"),
    }
  },
})
