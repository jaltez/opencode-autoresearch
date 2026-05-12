import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { buildFinalizePlan, renderFinalizePlan } from "../finalize"
import { loadAutoresearchSession } from "../storage"
import { isGitRepository } from "../git"
import { runtimeStore } from "../runtime"

export const autoresearchFinalizeTool = tool({
  description: "Plan or create review branches from kept autoresearch runs, grouped by non-overlapping file changes.",
  args: {
    createBranches: tool.schema.boolean().optional(),
    prefix: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Finalize autoresearch runs" })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    const plan = buildFinalizePlan(session.state.runs, args.prefix)
    if (plan.groups.length === 0) {
      return renderFinalizePlan(plan)
    }

    let branchOutput = ""
    let createdBranches: string[] = []
    if (args.createBranches) {
      await Effect.runPromise(context.ask({
        always: ["*"],
        metadata: { tool: "Finalize autoresearch runs", createBranches: true },
        patterns: ["git switch", "git cherry-pick", "git branch"],
        permission: "bash",
      }))
      const creation = await createFinalizeBranches(session.paths.directory, plan.groups)
      createdBranches = creation.created
      branchOutput = creation.output
    }

    return {
      metadata: {
        createdBranches,
        groupCount: plan.groups.length,
        warnings: plan.warnings,
      },
      output: [renderFinalizePlan(plan), branchOutput].filter(Boolean).join("\n\n"),
    }
  },
})

async function createFinalizeBranches(
  cwd: string,
  groups: ReturnType<typeof buildFinalizePlan>["groups"],
): Promise<{ created: string[]; output: string }> {
  if (!(await isGitRepository(cwd))) {
    return { created: [], output: "Skipping branch creation because the workdir is not a git repository." }
  }

  const oldestCommit = groups[0]?.commits[0]
  if (!oldestCommit) {
    return { created: [], output: "No commits available to finalize." }
  }

  const base = await runGit(cwd, ["rev-parse", `${oldestCommit}^`])
  if (base.exitCode !== 0) {
    return {
      created: [],
      output: "Unable to determine the parent of the oldest kept run commit. Branch creation needs at least one pre-autoresearch base commit.",
    }
  }

  const originalRef = await currentRef(cwd)
  const created: string[] = []
  const notes: string[] = []

  for (const group of groups) {
    const exists = await runGit(cwd, ["rev-parse", "--verify", group.branchName])
    if (exists.exitCode === 0) {
      notes.push(`Skipped ${group.branchName}: branch already exists.`)
      continue
    }

    const create = await runGit(cwd, ["switch", "-c", group.branchName, base.output.trim()])
    if (create.exitCode !== 0) {
      notes.push(`Failed to create ${group.branchName}: ${firstNonEmpty(create.stderr, create.output)}`)
      continue
    }

    const cherryPick = await runGit(cwd, ["cherry-pick", ...group.commits])
    if (cherryPick.exitCode !== 0) {
      await runGit(cwd, ["cherry-pick", "--abort"])
      await switchBack(cwd, originalRef)
      await runGit(cwd, ["branch", "-D", group.branchName])
      notes.push(`Failed to build ${group.branchName}: ${firstNonEmpty(cherryPick.stderr, cherryPick.output)}`)
      continue
    }

    created.push(group.branchName)
    notes.push(`Created ${group.branchName} from ${base.output.trim()} with commits ${group.commits.join(", ")}.`)
    await switchBack(cwd, originalRef)
  }

  await switchBack(cwd, originalRef)
  return { created, output: notes.join("\n") }
}

async function currentRef(cwd: string): Promise<string> {
  const branch = await runGit(cwd, ["branch", "--show-current"])
  if (branch.exitCode === 0 && branch.output.trim()) return branch.output.trim()
  const head = await runGit(cwd, ["rev-parse", "HEAD"])
  return head.output.trim()
}

async function switchBack(cwd: string, ref: string): Promise<void> {
  await runGit(cwd, ["switch", ref])
}

async function runGit(cwd: string, args: string[]): Promise<{ exitCode: number; output: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, output, stderr }
}

function firstNonEmpty(...values: string[]): string {
  return values.map((value) => value.trim()).find(Boolean) ?? "unknown git error"
}
