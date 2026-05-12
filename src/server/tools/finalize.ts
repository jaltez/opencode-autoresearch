import { tool } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { isAutoresearchArtifactPath } from "../../core/paths"
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
        patterns: ["git switch", "git checkout", "git commit", "git branch", "git stash", "git restore", "git diff", "git write-tree"],
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

  const baseRef = await resolveBaseRef(cwd, oldestCommit)
  if (!baseRef) {
    return {
      created: [],
      output: "Unable to determine the parent of the oldest kept run commit. Branch creation needs at least one pre-autoresearch base commit.",
    }
  }

  const originalRef = await currentRef(cwd)
  const finalRef = await resolveHeadRef(cwd)
  const created: string[] = []
  const notes: string[] = []
  const dirty = await hasDirtyWorktree(cwd)
  const stashRef = dirty ? await stashWorktree(cwd) : undefined
  if (dirty) {
    notes.push(stashRef ? `Stashed dirty worktree in ${stashRef} before finalize.` : "Attempted to stash a dirty worktree before finalize.")
  }

  let activeBranch: string | undefined

  try {
    for (const group of groups) {
      const exists = await branchExists(cwd, group.branchName)
      if (exists) {
        notes.push(`Skipped ${group.branchName}: branch already exists.`)
        continue
      }

      if (group.files.length === 0) {
        notes.push(`Skipped ${group.branchName}: group has no non-artifact files to review.`)
        continue
      }

      const lastCommit = group.commits.at(-1)
      if (!lastCommit) {
        notes.push(`Skipped ${group.branchName}: no last commit recorded for the group.`)
        continue
      }

      activeBranch = group.branchName
      await ensureGitSuccess(runGit(cwd, ["switch", "-c", group.branchName, baseRef]), `Failed to create ${group.branchName}`)
      await ensureGitSuccess(checkoutFilesFromCommit(cwd, lastCommit, group.files), `Failed to apply files to ${group.branchName}`)

      const hasDiff = await branchHasStagedDiff(cwd)
      if (!hasDiff) {
        await cleanupWorkingTreeToHead(cwd)
        await switchBack(cwd, originalRef)
        await deleteBranch(cwd, group.branchName)
        activeBranch = undefined
        notes.push(`Skipped ${group.branchName}: no reviewable diff remained after filtering artifacts.`)
        continue
      }

      const commitMessage = buildFinalizeCommitMessage(group)
      await ensureGitSuccess(runGit(cwd, ["commit", "-m", commitMessage]), `Failed to commit finalize branch ${group.branchName}`)

      created.push(group.branchName)
      notes.push(`Created ${group.branchName} from ${baseRef} using files from ${lastCommit}.`)
      await switchBack(cwd, originalRef)
      activeBranch = undefined
    }
  } catch (error) {
    const rollbackNotes = await rollbackFinalizeCreation(cwd, {
      activeBranch,
      createdBranches: created,
      originalRef,
      stashRef,
    })

    return {
      created: [],
      output: [
        "Finalize branch creation failed and was rolled back.",
        error instanceof Error ? error.message : String(error),
        ...rollbackNotes,
      ].filter(Boolean).join("\n"),
    }
  }

  await switchBack(cwd, originalRef)
  const verificationNotes = await verifyFinalizeBranches(cwd, {
    baseRef,
    createdBranches: created,
    finalRef,
    groups,
    originalRef,
  })
  notes.push(...verificationNotes)

  if (stashRef) {
    notes.push(await restoreStash(cwd, stashRef))
  }

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

async function resolveHeadRef(cwd: string): Promise<string> {
  const head = await runGit(cwd, ["rev-parse", "HEAD"])
  return head.output.trim()
}

async function resolveBaseRef(cwd: string, oldestCommit: string): Promise<string | undefined> {
  const base = await runGit(cwd, ["rev-parse", `${oldestCommit}^`])
  if (base.exitCode !== 0 || !base.output.trim()) return undefined
  return base.output.trim()
}

async function branchExists(cwd: string, branchName: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--verify", branchName])
  return result.exitCode === 0
}

async function hasDirtyWorktree(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])
  return result.exitCode === 0 && result.output.trim().length > 0
}

async function stashWorktree(cwd: string): Promise<string | undefined> {
  const before = await latestStashRef(cwd)
  await runGit(cwd, ["stash", "push", "-u", "-m", `autoresearch-finalize-${Date.now()}`])
  const after = await latestStashRef(cwd)
  return after && after !== before ? after : after
}

async function restoreStash(cwd: string, stashRef: string): Promise<string> {
  const result = await runGit(cwd, ["stash", "pop", stashRef])
  if (result.exitCode === 0) {
    return `Restored stashed worktree from ${stashRef}.`
  }
  return `Warning: could not restore ${stashRef}: ${firstNonEmpty(result.stderr, result.output)}`
}

async function latestStashRef(cwd: string): Promise<string | undefined> {
  const result = await runGit(cwd, ["stash", "list", "-1", "--format=%gd"])
  if (result.exitCode !== 0) return undefined
  const ref = result.output.trim()
  return ref || undefined
}

async function checkoutFilesFromCommit(cwd: string, commit: string, files: readonly string[]): Promise<{ exitCode: number; output: string; stderr: string }> {
  return runGit(cwd, ["checkout", commit, "--", ...files])
}

async function branchHasStagedDiff(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["diff", "--cached", "--quiet"])
  return result.exitCode === 1
}

async function cleanupWorkingTreeToHead(cwd: string): Promise<void> {
  await runGit(cwd, ["restore", "--staged", "--worktree", "--source=HEAD", "--", "."])
}

async function deleteBranch(cwd: string, branchName: string): Promise<void> {
  await runGit(cwd, ["branch", "-D", branchName])
}

async function rollbackFinalizeCreation(cwd: string, input: {
  activeBranch?: string
  createdBranches: string[]
  originalRef: string
  stashRef?: string
}): Promise<string[]> {
  const notes: string[] = []

  if (input.activeBranch) {
    await cleanupWorkingTreeToHead(cwd)
    await switchBack(cwd, input.originalRef)
    await deleteBranch(cwd, input.activeBranch)
    notes.push(`Rolled back incomplete branch ${input.activeBranch}.`)
  } else {
    await switchBack(cwd, input.originalRef)
  }

  for (const branchName of input.createdBranches) {
    await deleteBranch(cwd, branchName)
  }
  if (input.createdBranches.length > 0) {
    notes.push(`Deleted ${input.createdBranches.length} created finalize branch(es) during rollback.`)
  }

  if (input.stashRef) {
    notes.push(await restoreStash(cwd, input.stashRef))
  }

  return notes
}

async function verifyFinalizeBranches(cwd: string, input: {
  baseRef: string
  createdBranches: string[]
  finalRef: string
  groups: ReturnType<typeof buildFinalizePlan>["groups"]
  originalRef: string
}): Promise<string[]> {
  const notes: string[] = []

  const artifactLeaks: string[] = []
  for (const branchName of input.createdBranches) {
    const result = await runGit(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", branchName])
    const files = parseNameOnly(result.output)
    const leaked = files.filter((filePath) => isAutoresearchArtifactPath(filePath))
    if (leaked.length > 0) {
      artifactLeaks.push(`${branchName}: ${leaked.join(", ")}`)
    }
  }

  if (artifactLeaks.length > 0) {
    notes.push(`Verification warning: session artifacts leaked into finalize branches (${artifactLeaks.join("; ")}).`)
  } else if (input.createdBranches.length > 0) {
    notes.push("Verified finalize branches: no autoresearch session artifacts were included.")
  }

  if (input.createdBranches.length === 0) {
    return notes
  }

  await ensureGitSuccess(runGit(cwd, ["switch", "--detach", input.baseRef]), "Failed to enter finalize verification state")

  try {
    for (const group of input.groups) {
      const lastCommit = group.commits.at(-1)
      if (!lastCommit || group.files.length === 0) continue
      await ensureGitSuccess(checkoutFilesFromCommit(cwd, lastCommit, group.files), `Failed to stage verification files for ${group.branchName}`)
    }

    const tree = await runGit(cwd, ["write-tree"])
    await ensureGitSuccess(tree, "Failed to write the verification tree")

    const diff = await runGit(cwd, ["diff", "--name-only", tree.output.trim(), input.finalRef, "--"])
    await ensureGitSuccess(diff, "Failed to compare finalize branch union against the original branch")

    const mismatches = parseNameOnly(diff.output).filter((filePath) => !isAutoresearchArtifactPath(filePath))
    if (mismatches.length > 0) {
      notes.push(`Verification warning: finalize branch union differs from the original branch for ${mismatches.join(", ")}.`)
    } else {
      notes.push("Verified finalize branches: the union of review branches matches the final autoresearch branch.")
    }
  } finally {
    await cleanupWorkingTreeToHead(cwd)
    await switchBack(cwd, input.originalRef)
  }

  return notes
}

function buildFinalizeCommitMessage(group: ReturnType<typeof buildFinalizePlan>["groups"][number]): string {
  if (group.summaries[0]?.trim()) return group.summaries[0].trim()
  if (group.firstIteration === group.lastIteration) {
    return `autoresearch finalize: run #${group.firstIteration}`
  }
  return `autoresearch finalize: runs #${group.firstIteration}-#${group.lastIteration}`
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

function parseNameOnly(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

async function ensureGitSuccess(
  promise: Promise<{ exitCode: number; output: string; stderr: string }> | { exitCode: number; output: string; stderr: string },
  message: string,
): Promise<void> {
  const result = await promise
  if (result.exitCode === 0) return
  throw new Error(`${message}: ${firstNonEmpty(result.stderr, result.output)}`)
}
