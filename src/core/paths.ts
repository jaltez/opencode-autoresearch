import path from "node:path"

export const AUTORESEARCH_FILENAMES = {
  dashboard: "autoresearch.dashboard.html",
  ideas: "autoresearch.ideas.md",
  jsonl: "autoresearch.jsonl",
  notes: "autoresearch.md",
  state: "autoresearch.state.json",
} as const

export type AutoresearchFileKind = keyof typeof AUTORESEARCH_FILENAMES

export interface ResolvedAutoresearchPaths {
  dashboard: string
  directory: string
  ideas: string
  jsonl: string
  notes: string
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
    dashboard: path.join(directory, AUTORESEARCH_FILENAMES.dashboard),
    directory,
    ideas: path.join(directory, AUTORESEARCH_FILENAMES.ideas),
    jsonl: path.join(directory, AUTORESEARCH_FILENAMES.jsonl),
    notes: path.join(directory, AUTORESEARCH_FILENAMES.notes),
    state: path.join(directory, AUTORESEARCH_FILENAMES.state),
  }
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
