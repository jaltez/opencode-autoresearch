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

export function relativeToProject(projectDir: string, targetPath: string): string {
  return path.relative(path.resolve(projectDir), path.resolve(targetPath)) || "."
}
