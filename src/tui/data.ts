import { readFile } from "node:fs/promises"
import path from "node:path"
import { reconstructJsonlState } from "../core/jsonl"
import {
  AUTORESEARCH_FILENAMES,
  resolveAutoresearchPaths,
  type ResolvedAutoresearchPaths,
} from "../core/paths"
import type { AutoresearchState } from "../core/types"

export interface AutoresearchWorkspaceSnapshot {
  ideasText?: string
  notesText?: string
  paths: ResolvedAutoresearchPaths
  projectDir: string
  state: AutoresearchState
}

export async function loadAutoresearchWorkspaceSnapshot(
  projectDir: string,
  preferredWorkDir?: string,
): Promise<AutoresearchWorkspaceSnapshot | undefined> {
  const paths = await resolveSnapshotPaths(projectDir, preferredWorkDir)
  if (!paths) return undefined

  const [stateText, jsonlText, notesText, ideasText] = await Promise.all([
    readOptionalText(paths.state),
    readOptionalText(paths.jsonl),
    readOptionalText(paths.notes),
    readOptionalText(paths.ideas),
  ])

  const state = parseStateSnapshot(stateText) ?? reconstructJsonlState(jsonlText ?? "")
  if (!state.config && state.runs.length === 0 && state.hooks.length === 0 && state.notes.length === 0) {
    return undefined
  }

  return {
    ideasText,
    notesText,
    paths,
    projectDir,
    state,
  }
}

async function resolveSnapshotPaths(projectDir: string, preferredWorkDir?: string): Promise<ResolvedAutoresearchPaths | undefined> {
  const preferredCandidates = [preferredWorkDir, projectDir]
    .filter((value): value is string => Boolean(value))
    .map((value) => resolveAutoresearchPaths(projectDir, value))

  for (const candidate of preferredCandidates) {
    if (await hasAutoresearchFiles(candidate)) return candidate
  }

  const discoveredDirectory = await findAutoresearchDirectory(projectDir)
  if (!discoveredDirectory) return undefined
  return resolveAutoresearchPaths(projectDir, discoveredDirectory)
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

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
}

function parseStateSnapshot(text: string | undefined): AutoresearchState | undefined {
  if (!text) return undefined

  try {
    const parsed = JSON.parse(text) as Partial<AutoresearchState>
    if (!parsed || typeof parsed !== "object") return undefined
    if (!Array.isArray(parsed.runs) || !Array.isArray(parsed.hooks) || !Array.isArray(parsed.notes)) return undefined
    if (parsed.mode !== "active" && parsed.mode !== "off" && parsed.mode !== "paused") return undefined
    return parsed as AutoresearchState
  } catch {
    return undefined
  }
}