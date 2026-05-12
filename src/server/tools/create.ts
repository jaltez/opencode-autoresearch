import path from "node:path"
import { tool } from "@opencode-ai/plugin"
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
    name: tool.schema.string().optional(),
    objective: tool.schema.string().optional(),
    primaryMetric: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Create autoresearch scaffold" })

    const session = await loadAutoresearchSession(context.directory, args.workDir)
    const defaultName = args.name ?? session.state.config?.name ?? path.basename(session.paths.directory)
    const command = args.command ?? session.state.config?.command ?? (await inferDefaultCommand(context.directory))

    await ensureAutoresearchFiles(session.paths, {
      ideas: [
        "# Ideas",
        "",
        "- Capture experimental directions, discarded hypotheses, and next candidate changes here.",
      ].join("\n"),
      notes: [
        "# Autoresearch",
        "",
        `- Session: ${defaultName}`,
        `- Command: ${command ?? "<fill me in>"}`,
        `- Primary metric: ${args.primaryMetric ?? session.state.config?.primaryMetric ?? "<fill me in>"}`,
      ].join("\n"),
    })

    const hookResult = args.createHooks
      ? await scaffoldHookFiles({
          force: args.forceHooks ?? false,
          instructions: args.objective,
          workDir: session.paths.directory,
        })
      : undefined

    let initialized = false
    if (command) {
      const config = {
        checks: args.checks ?? session.state.config?.checks,
        command,
        createdAt: session.state.config?.createdAt ?? new Date().toISOString(),
        maxIterations: args.maxIterations ?? session.state.config?.maxIterations,
        name: defaultName,
        objective: args.objective ?? session.state.config?.objective,
        primaryMetric: args.primaryMetric ?? session.state.config?.primaryMetric,
        workDir: args.workDir ?? session.state.config?.workDir,
      }

      await appendJsonlEntry(session.paths, {
        at: new Date().toISOString(),
        config,
        mode: session.state.mode === "off" ? "active" : session.state.mode,
        type: "session",
      })
      initialized = true
    }

    const nextSession = await loadAutoresearchSession(context.directory, args.workDir)
    await writeStateSnapshot(nextSession.paths, nextSession.state)
    if (initialized) {
      runtimeStore.activate(context.sessionID, nextSession.paths.directory)
    }

    return {
      metadata: {
        command,
        hooks: hookResult,
        initialized,
        name: defaultName,
      },
      output: [
        `Prepared autoresearch scaffold for \"${defaultName}\".`,
        `Workdir: ${path.relative(context.directory, nextSession.paths.directory) || "."}`,
        command ? `Command: ${command}` : "Command: not inferred; run init_experiment or rerun autoresearch_create with command=...",
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
