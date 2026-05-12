import path from "node:path"

export const AUTORESEARCH_SESSION_FILENAMES = {
  checks: "autoresearch.checks.sh",
  config: "autoresearch.config.json",
  ideas: "autoresearch.ideas.md",
  jsonl: "autoresearch.jsonl",
  notes: "autoresearch.md",
  script: "autoresearch.sh",
} as const

export const AUTORESEARCH_DERIVED_FILENAMES = {
  dashboard: "autoresearch.dashboard.html",
  state: "autoresearch.state.json",
} as const

export const AUTORESEARCH_FILENAMES = {
  ...AUTORESEARCH_SESSION_FILENAMES,
  ...AUTORESEARCH_DERIVED_FILENAMES,
} as const

export const AUTORESEARCH_HOOKS_DIRECTORY = "autoresearch.hooks"

export const AUTORESEARCH_HOOK_FILENAMES = {
  after: "after.sh",
  before: "before.sh",
} as const

export type AutoresearchFileKind = keyof typeof AUTORESEARCH_FILENAMES
export type AutoresearchHookKind = keyof typeof AUTORESEARCH_HOOK_FILENAMES

export interface ResolvedAutoresearchPaths {
  checks: string
  config: string
  dashboard: string
  directory: string
  hooksDirectory: string
  ideas: string
  jsonl: string
  notes: string
  script: string
  state: string
}

export function resolveWorkDir(projectDir: string, configuredWorkDir?: string): string {
  if (!configuredWorkDir) return path.resolve(projectDir)
  if (path.isAbsolute(configuredWorkDir)) return path.normalize(configuredWorkDir)
  return path.resolve(projectDir, configuredWorkDir)
}

export function resolveAutoresearchPaths(projectDir: string, configuredWorkDir?: string): ResolvedAutoresearchPaths {
  const directory = resolveWorkDir(projectDir, configuredWorkDir)

  return {
    checks: path.join(directory, AUTORESEARCH_SESSION_FILENAMES.checks),
    config: path.join(directory, AUTORESEARCH_SESSION_FILENAMES.config),
    dashboard: path.join(directory, AUTORESEARCH_FILENAMES.dashboard),
    directory,
    hooksDirectory: path.join(directory, AUTORESEARCH_HOOKS_DIRECTORY),
    ideas: path.join(directory, AUTORESEARCH_FILENAMES.ideas),
    jsonl: path.join(directory, AUTORESEARCH_FILENAMES.jsonl),
    notes: path.join(directory, AUTORESEARCH_FILENAMES.notes),
    script: path.join(directory, AUTORESEARCH_SESSION_FILENAMES.script),
    state: path.join(directory, AUTORESEARCH_FILENAMES.state),
  }
}

export function resolveAutoresearchHookPath(paths: ResolvedAutoresearchPaths, kind: AutoresearchHookKind): string {
  return path.join(paths.hooksDirectory, AUTORESEARCH_HOOK_FILENAMES[kind])
}

export function resolveLegacyAutoresearchHookPath(paths: ResolvedAutoresearchPaths, kind: AutoresearchHookKind): string {
  return path.join(paths.directory, AUTORESEARCH_HOOK_FILENAMES[kind])
}

export function autoresearchHookCandidates(paths: ResolvedAutoresearchPaths, kind: AutoresearchHookKind): string[] {
  return [resolveAutoresearchHookPath(paths, kind), resolveLegacyAutoresearchHookPath(paths, kind)]
}

export function listAutoresearchArtifactPaths(): string[] {
  return [...new Set([
    ...Object.values(AUTORESEARCH_FILENAMES),
    ...Object.values(AUTORESEARCH_HOOK_FILENAMES),
    ...Object.values(AUTORESEARCH_HOOK_FILENAMES).map((fileName) => `${AUTORESEARCH_HOOKS_DIRECTORY}/${fileName}`),
  ])]
}

export function isAutoresearchArtifactPath(filePath: string): boolean {
  const normalized = normalizeArtifactPath(filePath)
  if (!normalized) return false
  if (listAutoresearchArtifactPaths().includes(normalized)) return true
  return normalized.startsWith(`${AUTORESEARCH_HOOKS_DIRECTORY}/`)
}

export async function resolveExistingAutoresearchPaths(
  projectDir: string,
  configuredWorkDir?: string,
): Promise<ResolvedAutoresearchPaths> {
  const preferredCandidates = [...new Set([configuredWorkDir, projectDir].filter((value): value is string => Boolean(value)))]
    .map((value) => resolveAutoresearchPaths(projectDir, value))

  for (const candidate of preferredCandidates) {
    if (await hasAutoresearchFiles(candidate)) return candidate
  }

  const discoveredDirectory = await findAutoresearchDirectory(projectDir)
  if (discoveredDirectory) {
    return resolveAutoresearchPaths(projectDir, discoveredDirectory)
  }

  return resolveAutoresearchPaths(projectDir, configuredWorkDir)
}

export function relativeToProject(projectDir: string, targetPath: string): string {
  return path.relative(path.resolve(projectDir), path.resolve(targetPath)) || "."
}

async function hasAutoresearchFiles(paths: ResolvedAutoresearchPaths): Promise<boolean> {
  return (await Bun.file(paths.state).exists()) || (await Bun.file(paths.jsonl).exists())
}

async function findAutoresearchDirectory(projectDir: string): Promise<string | undefined> {
  const direct = resolveAutoresearchPaths(projectDir)
  if (await hasAutoresearchFiles(direct)) return direct.directory

  const stateMatch = await findFirstMatchingFile(projectDir, AUTORESEARCH_FILENAMES.state)
  if (stateMatch) return path.dirname(stateMatch)

  const jsonlMatch = await findFirstMatchingFile(projectDir, AUTORESEARCH_FILENAMES.jsonl)
  if (jsonlMatch) return path.dirname(jsonlMatch)

  return undefined
}

async function findFirstMatchingFile(projectDir: string, fileName: string): Promise<string | undefined> {
  const glob = new Bun.Glob(`**/${fileName}`)
  const matches: string[] = []

  for await (const match of glob.scan({ cwd: projectDir, onlyFiles: true })) {
    matches.push(path.resolve(projectDir, match))
    if (matches.length >= 32) break
  }

  matches.sort((left, right) => {
    const leftDepth = path.relative(projectDir, left).split(path.sep).length
    const rightDepth = path.relative(projectDir, right).split(path.sep).length
    if (leftDepth !== rightDepth) return leftDepth - rightDepth
    return left.localeCompare(right)
  })

  return matches[0]
}

function normalizeArtifactPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.?\//u, "")
}
