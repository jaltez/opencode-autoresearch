import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { appendJsonlEntry, ensureAutoresearchFiles, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export const initExperimentTool = tool({
  description: "Initialize or update the autoresearch session configuration for the current project.",
  args: {
    checks: tool.schema.array(tool.schema.string()).optional(),
    command: tool.schema.string().min(1),
    maxIterations: tool.schema.number().int().positive().optional(),
    name: tool.schema.string().min(1),
    objective: tool.schema.string().optional(),
    primaryMetric: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Initialize autoresearch session" })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    const config = {
      checks: args.checks,
      command: args.command,
      createdAt: session.state.config?.createdAt ?? new Date().toISOString(),
      maxIterations: args.maxIterations,
      name: args.name,
      objective: args.objective,
      primaryMetric: args.primaryMetric,
      workDir: args.workDir,
    }

    await ensureAutoresearchFiles(session.paths, {
      ideas: ["# Ideas", "", "- Capture candidate experiments here."].join("\n"),
      notes: ["# Autoresearch", "", `- Session: ${args.name}`, `- Command: ${args.command}`].join("\n"),
    })

    await appendJsonlEntry(session.paths, {
      at: new Date().toISOString(),
      config,
      mode: "active",
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
        `Command: ${args.command}`,
      ].join("\n"),
    }
  },
})
