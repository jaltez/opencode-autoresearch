import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { AUTORESEARCH_CANONICAL_COMMAND, isAutoresearchScriptCommand } from "../../core/session-config"
import {
  buildAutoresearchChecksScriptTemplate,
  buildAutoresearchConfigTemplate,
  buildAutoresearchIdeasTemplate,
  buildAutoresearchNotesTemplate,
  buildAutoresearchScriptTemplate,
} from "../scaffold"
import { appendJsonlEntry, ensureAutoresearchFiles, loadAutoresearchSession, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"
import { scaffoldHookFiles } from "./hooks"

export const autoresearchCreateTool = tool({
  description: "Create or refresh the autoresearch scaffold and optionally initialize the session configuration.",
  args: {
    checks: tool.schema.array(tool.schema.string()).optional(),
    command: tool.schema.string().optional(),
    createHooks: tool.schema.boolean().optional(),
    forceHooks: tool.schema.boolean().optional(),
    maxIterations: tool.schema.number().int().positive().optional(),
    metricDirection: tool.schema.enum(["higher", "lower"]).optional(),
    metricUnit: tool.schema.string().optional(),
    name: tool.schema.string().optional(),
    objective: tool.schema.string().optional(),
    primaryMetric: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Create autoresearch scaffold" })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    const defaultName = args.name ?? session.state.config?.name ?? path.basename(session.paths.directory)
    const existingBenchmarkCommand = session.state.config?.benchmarkCommand
      ?? (session.state.config?.command && !isAutoresearchScriptCommand(session.state.config.command)
        ? session.state.config.command
        : undefined)
    const benchmarkCommand = args.command ?? existingBenchmarkCommand ?? (await inferDefaultCommand(context.directory))
    const configuredWorkDir = args.workDir ?? session.state.config?.workDir
    const configuredChecks = args.checks ?? session.state.config?.checks

    await ensureAutoresearchFiles(session.paths, {
      checksScript: buildAutoresearchChecksScriptTemplate(configuredChecks),
      config: buildAutoresearchConfigTemplate({
        maxIterations: args.maxIterations ?? session.state.config?.maxIterations,
        workDir: configuredWorkDir,
      }),
      ideas: buildAutoresearchIdeasTemplate(),
      notes: buildAutoresearchNotesTemplate({
        command: benchmarkCommand,
        name: defaultName,
        objective: args.objective ?? session.state.config?.objective,
        primaryMetric: args.primaryMetric ?? session.state.config?.primaryMetric,
      }),
      script: buildAutoresearchScriptTemplate({
        command: benchmarkCommand,
        primaryMetric: args.primaryMetric ?? session.state.config?.primaryMetric,
      }),
    })

    const hookResult = args.createHooks
      ? await scaffoldHookFiles({
          force: args.forceHooks ?? false,
          instructions: args.objective,
          workDir: session.paths.directory,
        })
      : undefined

    let initialized = false
    if (benchmarkCommand) {
      const config = {
        benchmarkCommand,
        checks: configuredChecks,
        command: AUTORESEARCH_CANONICAL_COMMAND,
        createdAt: session.state.config?.createdAt ?? new Date().toISOString(),
        maxIterations: args.maxIterations ?? session.state.config?.maxIterations,
        metricDirection: args.metricDirection ?? session.state.config?.metricDirection,
        metricUnit: args.metricUnit ?? session.state.config?.metricUnit,
        name: defaultName,
        objective: args.objective ?? session.state.config?.objective,
        primaryMetric: args.primaryMetric ?? session.state.config?.primaryMetric,
        workDir: configuredWorkDir,
      }

      await appendJsonlEntry(session.paths, {
        at: new Date().toISOString(),
        config,
        mode: session.state.mode === "off" ? "active" : session.state.mode,
        segment: (session.state.currentSegment ?? 0) + 1,
        type: "session",
      })
      initialized = true
    }

    const nextSession = await loadAutoresearchSession(context.directory, workDir)
    await writeStateSnapshot(nextSession.paths, nextSession.state)
    if (initialized) {
      runtimeStore.activate(context.sessionID, nextSession.paths.directory)
    }

    return {
      metadata: {
        benchmarkCommand,
        command: benchmarkCommand ? AUTORESEARCH_CANONICAL_COMMAND : undefined,
        hooks: hookResult,
        initialized,
        name: defaultName,
      },
      output: [
        `Prepared autoresearch scaffold for \"${defaultName}\".`,
        `Workdir: ${path.relative(context.directory, nextSession.paths.directory) || "."}`,
        benchmarkCommand
          ? `Command: ${AUTORESEARCH_CANONICAL_COMMAND} (benchmark: ${benchmarkCommand})`
          : "Command: not inferred; run init_experiment or rerun autoresearch_create with command=...",
        hookResult ? `Hooks: created ${hookResult.created.join(", ") || "none"}; skipped ${hookResult.skipped.join(", ") || "none"}` : "Hooks: unchanged",
      ].join("\n"),
    }
  },
})

async function inferDefaultCommand(projectDir: string): Promise<string | undefined> {
  const packageFile = Bun.file(path.join(projectDir, "package.json"))
  if (!(await packageFile.exists())) return undefined

  try {
    const parsed = JSON.parse(await packageFile.text()) as { packageManager?: string; scripts?: Record<string, string> }
    if (!parsed.scripts?.test) return undefined

    if (parsed.packageManager?.startsWith("bun@")) return "bun test"
    if (await Bun.file(path.join(projectDir, "bun.lock")).exists()) return "bun test"
    if (await Bun.file(path.join(projectDir, "bun.lockb")).exists()) return "bun test"
    if (await Bun.file(path.join(projectDir, "pnpm-lock.yaml")).exists()) return "pnpm test"
    if (await Bun.file(path.join(projectDir, "yarn.lock")).exists()) return "yarn test"
    return "npm test"
  } catch {
    return undefined
  }
}
