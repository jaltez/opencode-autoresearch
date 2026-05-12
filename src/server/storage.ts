import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { buildAutoresearchCompactionSummary } from "../core/compaction"
import { reconstructJsonlState, serializeJsonlEntry } from "../core/jsonl"
import { resolveAutoresearchPaths, type ResolvedAutoresearchPaths } from "../core/paths"
import type { AutoresearchJsonlEntry, AutoresearchState } from "../core/types"

export interface LoadedAutoresearchSession {
  ideasText?: string
  notesText?: string
  paths: ResolvedAutoresearchPaths
  state: AutoresearchState
}

export async function loadAutoresearchSession(projectDir: string, configuredWorkDir?: string): Promise<LoadedAutoresearchSession> {
  const paths = resolveAutoresearchPaths(projectDir, configuredWorkDir)
  const [jsonlText, notesText, ideasText] = await Promise.all([
    readOptionalText(paths.jsonl),
    readOptionalText(paths.notes),
    readOptionalText(paths.ideas),
  ])

  return {
    ideasText,
    notesText,
    paths,
    state: reconstructJsonlState(jsonlText ?? ""),
  }
}

export async function appendJsonlEntry(paths: ResolvedAutoresearchPaths, entry: AutoresearchJsonlEntry): Promise<void> {
  await ensureAutoresearchDirectory(paths)
  await appendFile(paths.jsonl, serializeJsonlEntry(entry), "utf8")
}

export async function ensureAutoresearchDirectory(paths: ResolvedAutoresearchPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true })
}

export async function ensureAutoresearchFiles(paths: ResolvedAutoresearchPaths, input: { ideas?: string; notes?: string }): Promise<void> {
  await ensureAutoresearchDirectory(paths)

  if ((await readOptionalText(paths.notes)) === undefined) {
    await writeAtomic(paths.notes, input.notes ?? "# Autoresearch\n\n")
  }

  if ((await readOptionalText(paths.ideas)) === undefined) {
    await writeAtomic(paths.ideas, input.ideas ?? "# Ideas\n\n")
  }
}

export async function removeAutoresearchFiles(paths: ResolvedAutoresearchPaths): Promise<void> {
  await Promise.all([
    rm(paths.dashboard, { force: true }).catch(() => undefined),
    rm(paths.ideas, { force: true }).catch(() => undefined),
    rm(paths.jsonl, { force: true }).catch(() => undefined),
    rm(paths.notes, { force: true }).catch(() => undefined),
    rm(paths.state, { force: true }).catch(() => undefined),
  ])
}

export async function writeDashboard(paths: ResolvedAutoresearchPaths, state: AutoresearchState, notesText?: string, ideasText?: string): Promise<string> {
  const summary = buildAutoresearchCompactionSummary({ ideasText, notesText, state })
  const html = renderDashboardHtml(summary)
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

function renderDashboardHtml(summary: string): string {
  const escaped = escapeHtml(summary)
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Autoresearch Dashboard</title>",
    "  <style>",
    "    :root { color-scheme: light; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }",
    "    body { margin: 0; background: #f5f0e8; color: #1d1b18; }",
    "    main { max-width: 960px; margin: 0 auto; padding: 32px 20px 56px; }",
    "    h1 { font-size: 28px; margin: 0 0 12px; }",
    "    p { margin: 0 0 20px; color: #5e574d; }",
    "    pre { white-space: pre-wrap; background: #fffdf8; border: 1px solid #d8cfbe; border-radius: 16px; padding: 20px; overflow: auto; line-height: 1.45; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    "    <h1>Autoresearch Dashboard</h1>",
    "    <p>Minimal browser export generated from the current autoresearch session state.</p>",
    `    <pre>${escaped}</pre>`,
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`)
  await writeFile(tempPath, content, "utf8")
  await rename(tempPath, filePath)
}
