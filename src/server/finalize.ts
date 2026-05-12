import { isAutoresearchArtifactPath } from "../core/paths"
import type { ExperimentRun } from "../core/types"

export interface FinalizeCandidate {
  commit: string
  files: string[]
  id: string
  iteration: number
  summary?: string
}

export interface FinalizeGroup {
  branchName: string
  commits: string[]
  files: string[]
  firstIteration: number
  lastIteration: number
  runIDs: string[]
  summaries: string[]
}

export interface FinalizePlan {
  groups: FinalizeGroup[]
  warnings: string[]
}

export function buildFinalizePlan(runs: readonly ExperimentRun[], prefix = "autoresearch"): FinalizePlan {
  const warnings: string[] = []
  const candidates: FinalizeCandidate[] = []

  for (const run of runs) {
    if (run.decision !== "keep" && run.status !== "kept") continue
    if (!run.commit) {
      warnings.push(`Run #${run.iteration} was kept but has no recorded commit.`)
      continue
    }

    const files = unique([...(run.changes?.modified ?? []), ...(run.changes?.untracked ?? [])])
      .filter((filePath) => !isAutoresearchArtifactPath(filePath))
    if (files.length === 0) {
      warnings.push(`Run #${run.iteration} was kept but has no non-artifact file list.`)
      continue
    }

    candidates.push({
      commit: run.commit,
      files,
      id: run.id,
      iteration: run.iteration,
      summary: run.summary,
    })
  }

  const groups = mergeOverlappingCandidates(candidates).map((group, index) => {
    const sorted = [...group].sort((left, right) => left.iteration - right.iteration)
    const firstIteration = sorted[0]?.iteration ?? 0
    const lastIteration = sorted.at(-1)?.iteration ?? firstIteration
    const summary = sorted.map((item) => item.summary).find(Boolean)
    return {
      branchName: makeBranchName(prefix, index + 1, firstIteration, lastIteration, summary, sorted.flatMap((item) => item.files)),
      commits: sorted.map((item) => item.commit),
      files: unique(sorted.flatMap((item) => item.files)).sort(),
      firstIteration,
      lastIteration,
      runIDs: sorted.map((item) => item.id),
      summaries: sorted.map((item) => item.summary).filter((value): value is string => Boolean(value)),
    }
  })

  return { groups, warnings }
}

export function renderFinalizePlan(plan: FinalizePlan): string {
  if (plan.groups.length === 0) {
    return [
      "# Autoresearch Finalize",
      "",
      "- No kept runs with commits are available to finalize yet.",
      ...plan.warnings.map((warning) => `- Warning: ${warning}`),
    ].join("\n")
  }

  const lines = ["# Autoresearch Finalize", ""]

  for (const [index, group] of plan.groups.entries()) {
    lines.push(`## Group ${index + 1}`)
    lines.push(`- Branch: ${group.branchName}`)
    lines.push(`- Iterations: ${group.firstIteration}${group.lastIteration !== group.firstIteration ? `-${group.lastIteration}` : ""}`)
    lines.push(`- Commits: ${group.commits.join(", ")}`)
    lines.push(`- Files: ${group.files.length > 0 ? group.files.join(", ") : "none recorded"}`)
    if (group.summaries.length > 0) {
      lines.push(`- Summary: ${group.summaries.join(" | ")}`)
    }
    lines.push("")
  }

  if (plan.warnings.length > 0) {
    lines.push("## Warnings")
    lines.push(...plan.warnings.map((warning) => `- ${warning}`))
  }

  return lines.join("\n")
}

function mergeOverlappingCandidates(candidates: readonly FinalizeCandidate[]): FinalizeCandidate[][] {
  const groups: FinalizeCandidate[][] = []

  for (const candidate of [...candidates].sort((left, right) => left.iteration - right.iteration)) {
    const overlaps = groups.filter((group) => hasOverlap(group, candidate))
    if (overlaps.length === 0) {
      groups.push([candidate])
      continue
    }

    const target = overlaps[0]
    target.push(candidate)
    for (const extra of overlaps.slice(1)) {
      target.push(...extra)
      groups.splice(groups.indexOf(extra), 1)
    }
  }

  return groups
}

function hasOverlap(group: readonly FinalizeCandidate[], candidate: FinalizeCandidate): boolean {
  if (candidate.files.length === 0) return false
  const seen = new Set(group.flatMap((item) => item.files))
  return candidate.files.some((filePath) => seen.has(filePath))
}

function makeBranchName(
  prefix: string,
  index: number,
  firstIteration: number,
  lastIteration: number,
  summary: string | undefined,
  files: string[],
): string {
  const raw = summary ?? files[0] ?? `group-${index}`
  const slug = slugify(raw)
  const runRange = firstIteration === lastIteration ? `${firstIteration}` : `${firstIteration}-${lastIteration}`
  return `${prefix}/run-${runRange}-${slug || `group-${index}`}`.slice(0, 120)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
