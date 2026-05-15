import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { buildAutoresearchPresentationModel } from "../autoresearch-presentation"
import { reconstructJsonlState, serializeJsonlEntry } from "../core/jsonl"
import { normalizeAutoresearchState } from "../core/session-config"
import {
  listAutoresearchManagedPaths,
  resolveExistingAutoresearchPaths,
  type ResolvedAutoresearchPaths,
} from "../core/paths"
import { renderDashboardHtml } from "./dashboard-html"
import {
  getAutoresearchDurabilityStatus,
  inspectAutoresearchJsonl,
  parseStateSnapshot,
  type AutoresearchDurabilityStatus,
} from "./durability"
import type { AutoresearchJsonlEntry, AutoresearchState } from "../core/types"

export interface LoadedAutoresearchSession {
  durability: AutoresearchDurabilityStatus
  ideasText?: string
  notesText?: string
  paths: ResolvedAutoresearchPaths
  state: AutoresearchState
}

export async function loadAutoresearchSession(projectDir: string, configuredWorkDir?: string): Promise<LoadedAutoresearchSession> {
  const paths = await resolveExistingAutoresearchPaths(projectDir, configuredWorkDir)
  const [jsonlText, notesText, ideasText, stateText] = await Promise.all([
    readOptionalText(paths.jsonl),
    readOptionalText(paths.notes),
    readOptionalText(paths.ideas),
    readOptionalText(paths.state),
  ])

  const snapshotState = parseStateSnapshot(stateText)
  const jsonlInspection = jsonlText ? inspectAutoresearchJsonl(jsonlText) : undefined
  const durability = await getAutoresearchDurabilityStatus({
    jsonlText,
    paths,
    stateText,
  })
  const baseState = jsonlText && jsonlInspection?.invalidLineNumbers.length === 0
    ? jsonlInspection.state
    : snapshotState ?? reconstructJsonlState(jsonlText ?? "")
  const state = await normalizeAutoresearchState(paths, baseState)

  return {
    durability,
    ideasText,
    notesText,
    paths,
    state,
  }
}

export async function appendJsonlEntry(paths: ResolvedAutoresearchPaths, entry: AutoresearchJsonlEntry): Promise<void> {
  await ensureAutoresearchDirectory(paths)
  const existing = await readOptionalText(paths.jsonl)
  if (existing) {
    const inspection = inspectAutoresearchJsonl(existing)
    if (inspection.invalidLineNumbers.length > 0) {
      throw new Error(`Refusing to append to autoresearch.jsonl because line(s) ${inspection.invalidLineNumbers.join(", ")} are invalid. Restore or repair the file before continuing.`)
    }
  }

  const nextContent = `${existing ?? ""}${serializeJsonlEntry(entry)}`
  const nextInspection = inspectAutoresearchJsonl(nextContent)
  if (nextInspection.invalidLineNumbers.length > 0) {
    throw new Error(`Refusing to write invalid autoresearch.jsonl content. Validation failed on line(s) ${nextInspection.invalidLineNumbers.join(", ")}.`)
  }

  await writeAtomic(paths.jsonl, nextContent, { verifyContent: nextContent })
}

export async function ensureAutoresearchDirectory(paths: ResolvedAutoresearchPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true })
}

export async function ensureAutoresearchFiles(
  paths: ResolvedAutoresearchPaths,
  input: {
    checksScript?: string
    config?: string
    createHooksDirectory?: boolean
    ideas?: string
    notes?: string
    script?: string
  },
): Promise<void> {
  await ensureAutoresearchDirectory(paths)

  if ((await readOptionalText(paths.notes)) === undefined) {
    await writeAtomic(paths.notes, input.notes ?? "# Autoresearch\n\n")
  }

  if ((await readOptionalText(paths.ideas)) === undefined) {
    await writeAtomic(paths.ideas, input.ideas ?? "# Ideas\n\n")
  }

  if (input.script !== undefined && (await readOptionalText(paths.script)) === undefined) {
    await writeExecutableAtomic(paths.script, input.script)
  }

  if (input.config !== undefined && (await readOptionalText(paths.config)) === undefined) {
    await writeAtomic(paths.config, input.config)
  }

  if (input.checksScript !== undefined && (await readOptionalText(paths.checks)) === undefined) {
    await writeExecutableAtomic(paths.checks, input.checksScript)
  }

  if (input.createHooksDirectory) {
    await mkdir(paths.hooksDirectory, { recursive: true })
  }
}

export async function removeAutoresearchFiles(
  paths: ResolvedAutoresearchPaths,
  options?: { includeBackups?: boolean },
): Promise<void> {
  await Promise.all(listAutoresearchManagedPaths(paths, { includeBackups: options?.includeBackups }).map(async (managedPath) => {
    await rm(managedPath, { force: true, recursive: true }).catch(() => undefined)
  }))
}

export async function writeDashboard(
  paths: ResolvedAutoresearchPaths,
  state: AutoresearchState,
  notesText?: string,
  ideasText?: string,
  projectDir = paths.directory,
  durability?: AutoresearchDurabilityStatus,
): Promise<string> {
  const model = buildAutoresearchPresentationModel({
    durability,
    ideasText,
    notesText,
    paths,
    projectDir,
    state,
  })
  const html = renderDashboardHtml(model)
  await ensureAutoresearchDirectory(paths)
  await writeAtomic(paths.dashboard, html, { verifyContent: html })
  return paths.dashboard
}

export async function writeStateSnapshot(paths: ResolvedAutoresearchPaths, state: AutoresearchState): Promise<void> {
  await ensureAutoresearchDirectory(paths)
  const content = `${JSON.stringify(state, null, 2)}\n`
  await writeAtomic(paths.state, content, { verifyContent: content })
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
}

async function writeAtomic(filePath: string, content: string, options?: { verifyContent?: string }): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`)
  await writeFile(tempPath, content, "utf8")
  await rename(tempPath, filePath)
  if (options?.verifyContent !== undefined) {
    const persisted = await readFile(filePath, "utf8")
    if (persisted !== options.verifyContent) {
      throw new Error(`Verification failed after writing ${path.basename(filePath)}.`)
    }
  }
}

async function writeExecutableAtomic(filePath: string, content: string): Promise<void> {
  await writeAtomic(filePath, content, { verifyContent: content })
  await chmod(filePath, 0o755)
}
