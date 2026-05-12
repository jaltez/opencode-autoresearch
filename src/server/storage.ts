import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { buildAutoresearchPresentationModel } from "../autoresearch-presentation"
import { reconstructJsonlState, serializeJsonlEntry } from "../core/jsonl"
import { normalizeAutoresearchState } from "../core/session-config"
import {
  resolveExistingAutoresearchPaths,
  resolveLegacyAutoresearchHookPath,
  type ResolvedAutoresearchPaths,
} from "../core/paths"
import { renderDashboardHtml } from "./dashboard-html"
import type { AutoresearchJsonlEntry, AutoresearchState } from "../core/types"

export interface LoadedAutoresearchSession {
  ideasText?: string
  notesText?: string
  paths: ResolvedAutoresearchPaths
  state: AutoresearchState
}

export async function loadAutoresearchSession(projectDir: string, configuredWorkDir?: string): Promise<LoadedAutoresearchSession> {
  const paths = await resolveExistingAutoresearchPaths(projectDir, configuredWorkDir)
  const [jsonlText, notesText, ideasText] = await Promise.all([
    readOptionalText(paths.jsonl),
    readOptionalText(paths.notes),
    readOptionalText(paths.ideas),
  ])

  const state = await normalizeAutoresearchState(paths, reconstructJsonlState(jsonlText ?? ""))

  return {
    ideasText,
    notesText,
    paths,
    state,
  }
}

export async function appendJsonlEntry(paths: ResolvedAutoresearchPaths, entry: AutoresearchJsonlEntry): Promise<void> {
  await ensureAutoresearchDirectory(paths)
  await appendFile(paths.jsonl, serializeJsonlEntry(entry), "utf8")
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

export async function removeAutoresearchFiles(paths: ResolvedAutoresearchPaths): Promise<void> {
  await Promise.all([
    rm(paths.checks, { force: true }).catch(() => undefined),
    rm(paths.config, { force: true }).catch(() => undefined),
    rm(paths.dashboard, { force: true }).catch(() => undefined),
    rm(paths.hooksDirectory, { force: true, recursive: true }).catch(() => undefined),
    rm(paths.ideas, { force: true }).catch(() => undefined),
    rm(paths.jsonl, { force: true }).catch(() => undefined),
    rm(paths.notes, { force: true }).catch(() => undefined),
    rm(resolveLegacyAutoresearchHookPath(paths, "before"), { force: true }).catch(() => undefined),
    rm(resolveLegacyAutoresearchHookPath(paths, "after"), { force: true }).catch(() => undefined),
    rm(paths.script, { force: true }).catch(() => undefined),
    rm(paths.state, { force: true }).catch(() => undefined),
  ])
}

export async function writeDashboard(
  paths: ResolvedAutoresearchPaths,
  state: AutoresearchState,
  notesText?: string,
  ideasText?: string,
  projectDir = paths.directory,
): Promise<string> {
  const model = buildAutoresearchPresentationModel({
    ideasText,
    notesText,
    paths,
    projectDir,
    state,
  })
  const html = renderDashboardHtml(model)
  await ensureAutoresearchDirectory(paths)
  await writeAtomic(paths.dashboard, html)
  return paths.dashboard
}

export async function writeStateSnapshot(paths: ResolvedAutoresearchPaths, state: AutoresearchState): Promise<void> {
  await ensureAutoresearchDirectory(paths)
  await writeAtomic(paths.state, `${JSON.stringify(state, null, 2)}\n`)
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return undefined
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`)
  await writeFile(tempPath, content, "utf8")
  await rename(tempPath, filePath)
}

async function writeExecutableAtomic(filePath: string, content: string): Promise<void> {
  await writeAtomic(filePath, content)
  await chmod(filePath, 0o755)
}
