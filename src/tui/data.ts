import { readFile } from "node:fs/promises"
import { reconstructJsonlState } from "../core/jsonl"
import { normalizeAutoresearchState } from "../core/session-config"
import {
  resolveExistingAutoresearchPaths,
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
  const paths = await resolveExistingAutoresearchPaths(projectDir, preferredWorkDir)

  const [stateText, jsonlText, notesText, ideasText] = await Promise.all([
    readOptionalText(paths.state),
    readOptionalText(paths.jsonl),
    readOptionalText(paths.notes),
    readOptionalText(paths.ideas),
  ])

  const state = await normalizeAutoresearchState(paths, parseStateSnapshot(stateText) ?? reconstructJsonlState(jsonlText ?? ""))
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