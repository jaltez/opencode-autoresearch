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

export interface KeepRunChangesResult {
  commit?: string
  output: string
  status: "committed" | "failed" | "skipped"
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runCommand(cwd, "git rev-parse --is-inside-work-tree")
  return result.exitCode === 0 && result.output.trim() === "true"
}

export async function captureGitChanges(cwd: string, preservedPaths: readonly string[]): Promise<GitChanges> {
  if (!(await isGitRepository(cwd))) {
    return { modified: [], untracked: [] }
  }

  const prefixResult = await runCommand(cwd, "git rev-parse --show-prefix")
  const pathPrefix = prefixResult.exitCode === 0 ? normalizeGitPath(prefixResult.output.trim()) : ""
  const result = await runCommand(cwd, "git status --porcelain=v1 -z -uall")
  if (result.exitCode !== 0) {
    return { modified: [], untracked: [] }
  }

  return parseGitStatus(result.output, preservedPaths, pathPrefix)
}

export async function keepRunChanges(cwd: string, run: ExperimentRun, preservedPaths: readonly string[]): Promise<KeepRunChangesResult> {
  if (!(await isGitRepository(cwd))) {
    return { output: "Skipping commit because the workdir is not a git repository.", status: "skipped" }
  }

  const trackedPaths = run.changes?.modified.filter((item) => !preservedPaths.includes(item) && !isAutoresearchArtifactPath(item)) ?? []
  const untrackedPaths = run.changes?.untracked.filter((item) => !preservedPaths.includes(item) && !isAutoresearchArtifactPath(item)) ?? []
  const paths = [...trackedPaths, ...untrackedPaths]
  if (paths.length === 0) {
    return { output: "No non-artifact changes were recorded for this run.", status: "skipped" }
  }

  const addResult = await runCommand(cwd, buildGitAddCommand(paths))
  if (addResult.exitCode !== 0) {
    return { output: addResult.stderr || addResult.output || "git add produced no output.", status: "failed" }
  }

  const message = shellQuote(buildKeepCommitMessage(run))
  const commitResult = await runCommand(cwd, `git commit -m ${message}`)
  if (commitResult.exitCode !== 0) {
    return { output: commitResult.stderr || commitResult.output || "git commit produced no output.", status: "failed" }
  }

  const hashResult = await runCommand(cwd, "git rev-parse HEAD")
  return {
    commit: hashResult.exitCode === 0 ? hashResult.output.trim() : undefined,
    output: commitResult.output || commitResult.stderr || "Committed run changes.",
    status: "committed",
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

  // Fall back to a whole-tree reset when the run has no recorded change set.
  if (trackedPaths.length === 0 && untrackedPaths.length === 0 && !run.changes) {
    const restoreAll = await runCommand(
      cwd,
      "git checkout -- . ':(exclude,glob)**/autoresearch.*'",
    )
    if (restoreAll.output.trim()) outputs.push(restoreAll.output.trim())
    if (restoreAll.stderr.trim()) outputs.push(restoreAll.stderr.trim())
    const cleanAll = await runCommand(
      cwd,
      "git clean -fd -- . ':(exclude,glob)**/autoresearch.*'",
    )
    if (cleanAll.output.trim()) outputs.push(cleanAll.output.trim())
    if (cleanAll.stderr.trim()) outputs.push(cleanAll.stderr.trim())
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

function parseGitStatus(output: string, preservedPaths: readonly string[], pathPrefix = ""): GitChanges {
  const modified = new Set<string>()
  const untracked = new Set<string>()
  const records = output.split("\0").filter(Boolean)

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const status = record.slice(0, 2)
    const filePath = normalizeGitPath(record.slice(3), pathPrefix)
    if (!filePath || preservedPaths.includes(filePath) || isAutoresearchArtifactPath(filePath)) continue

    if (status === "??") {
      untracked.add(filePath)
      continue
    }

    if (status.includes("R") || status.includes("C")) {
      const sourcePath = normalizeGitPath(records[index + 1] ?? "", pathPrefix)
      index += sourcePath ? 1 : 0
      if (!preservedPaths.includes(filePath) && !isAutoresearchArtifactPath(filePath)) {
        if (status.includes("R")) {
          modified.add(filePath)
        } else {
          untracked.add(filePath)
        }
      }
      continue
    }

    modified.add(filePath)
  }

  return {
    modified: [...modified],
    untracked: [...untracked],
  }
}

function normalizeGitPath(filePath: string, pathPrefix = ""): string {
  const renamed = filePath.includes(" -> ") ? filePath.split(" -> ").at(-1) ?? filePath : filePath
  const normalized = renamed.replaceAll("\\", "/")
  return pathPrefix && normalized.startsWith(pathPrefix) ? normalized.slice(pathPrefix.length) : normalized
}

function buildKeepCommitMessage(run: ExperimentRun): string {
  return [
    `autoresearch: keep run #${run.iteration}`,
    "",
    `Autoresearch-Result: ${JSON.stringify(buildResultTrailer(run))}`,
    `Autoresearch-Metrics: ${JSON.stringify(run.metrics.map(formatMetricTrailer))}`,
  ].join("\n")
}

function buildResultTrailer(run: ExperimentRun): Record<string, unknown> {
  return omitUndefined({
    checks: run.checks?.map((check) => ({
      command: check.command,
      exitCode: check.exitCode,
      passed: check.passed,
    })),
    confidence: run.confidence,
    decision: run.decision,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    iteration: run.iteration,
    runId: run.id,
    segment: run.segment,
    status: run.status,
    summary: run.summary,
  })
}

function formatMetricTrailer(metric: ExperimentRun["metrics"][number]): Record<string, unknown> {
  return omitUndefined({
    higherIsBetter: metric.higherIsBetter,
    name: metric.name,
    unit: metric.unit,
    value: metric.value,
  })
}

function omitUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function shellQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}
