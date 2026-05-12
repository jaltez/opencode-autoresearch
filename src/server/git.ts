import { access } from "node:fs/promises"
import path from "node:path"
import { isAutoresearchArtifactPath, listAutoresearchArtifactPaths } from "../core/paths"
import type { ExperimentRun } from "../core/types"

export interface GitChanges {
  modified: string[]
  untracked: string[]
}

export interface GitCommandResult {
  exitCode: number
  output: string
  stderr: string
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runCommand(cwd, "git rev-parse --is-inside-work-tree")
  return result.exitCode === 0 && result.output.trim() === "true"
}

export async function captureGitChanges(cwd: string, preservedPaths: readonly string[]): Promise<GitChanges> {
  if (!(await isGitRepository(cwd))) {
    return { modified: [], untracked: [] }
  }

  const result = await runCommand(cwd, "git status --porcelain=v1 -z")
  if (result.exitCode !== 0) {
    return { modified: [], untracked: [] }
  }

  return parseGitStatus(result.output, preservedPaths)
}

export async function keepRunChanges(cwd: string, run: ExperimentRun, preservedPaths: readonly string[]): Promise<{ commit?: string; output: string }> {
  if (!(await isGitRepository(cwd))) {
    return { output: "Skipping commit because the workdir is not a git repository." }
  }

  const trackedPaths = run.changes?.modified.filter((item) => !preservedPaths.includes(item) && !isAutoresearchArtifactPath(item)) ?? []
  const untrackedPaths = run.changes?.untracked.filter((item) => !preservedPaths.includes(item) && !isAutoresearchArtifactPath(item)) ?? []
  const paths = [...trackedPaths, ...untrackedPaths]
  if (paths.length === 0) {
    return { output: "No non-artifact changes were recorded for this run." }
  }

  const addResult = await runCommand(cwd, buildGitAddCommand(paths))
  if (addResult.exitCode !== 0) {
    return { output: addResult.stderr || addResult.output }
  }

  const message = shellQuote(`autoresearch: keep run #${run.iteration}`)
  const commitResult = await runCommand(cwd, `git commit -m ${message}`)
  if (commitResult.exitCode !== 0) {
    return { output: commitResult.stderr || commitResult.output || "git commit produced no output." }
  }

  const hashResult = await runCommand(cwd, "git rev-parse HEAD")
  return {
    commit: hashResult.exitCode === 0 ? hashResult.output.trim() : undefined,
    output: commitResult.output || commitResult.stderr || "Committed run changes.",
  }
}

export async function discardRunChanges(cwd: string, run: ExperimentRun, preservedPaths: readonly string[]): Promise<string> {
  if (!(await isGitRepository(cwd))) {
    return "Skipping discard because the workdir is not a git repository."
  }

  const trackedPaths = run.changes?.modified.filter((item) => !preservedPaths.includes(item) && !isAutoresearchArtifactPath(item)) ?? []
  const untrackedPaths = run.changes?.untracked.filter((item) => !preservedPaths.includes(item) && !isAutoresearchArtifactPath(item)) ?? []
  const outputs: string[] = []

  if (trackedPaths.length > 0) {
    const restore = await runCommand(cwd, buildGitRestoreCommand(trackedPaths))
    if (restore.output.trim()) outputs.push(restore.output.trim())
    if (restore.stderr.trim()) outputs.push(restore.stderr.trim())
  }

  for (const filePath of untrackedPaths) {
    const absolute = path.resolve(cwd, filePath)
    try {
      await access(absolute)
      await Bun.$`rm -rf ${absolute}`.quiet()
    } catch {
      continue
    }
  }

  if (outputs.length === 0) return "Discarded recorded run changes."
  return outputs.join("\n")
}

export function preservedArtifactPaths(workDir: string): string[] {
  return listAutoresearchArtifactPaths().map((item) => path.relative(workDir, path.join(workDir, item)) || item)
}

async function runCommand(cwd: string, command: string): Promise<GitCommandResult> {
  const proc = Bun.spawn(["/bin/bash", "-lc", command], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  })
  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { exitCode, output, stderr }
}

function buildGitAddCommand(paths: readonly string[]): string {
  const joined = paths.map(shellQuote).join(" ")
  return `git add -- ${joined}`
}

function buildGitRestoreCommand(paths: readonly string[]): string {
  const joined = paths.map(shellQuote).join(" ")
  return `git restore --staged --worktree --source=HEAD -- ${joined}`
}

function parseGitStatus(output: string, preservedPaths: readonly string[]): GitChanges {
  const modified = new Set<string>()
  const untracked = new Set<string>()

  for (const record of output.split("\0")) {
    if (!record) continue
    const status = record.slice(0, 2)
    const filePath = normalizeGitPath(record.slice(3))
    if (!filePath || preservedPaths.includes(filePath) || isAutoresearchArtifactPath(filePath)) continue

    if (status === "??") {
      untracked.add(filePath)
      continue
    }

    modified.add(filePath)
  }

  return {
    modified: [...modified],
    untracked: [...untracked],
  }
}

function normalizeGitPath(filePath: string): string {
  const renamed = filePath.includes(" -> ") ? filePath.split(" -> ").at(-1) ?? filePath : filePath
  return renamed.replaceAll("\\", "/")
}

function shellQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}
