import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { parseJsonlLine, reconstructJsonlState } from "../core/jsonl"
import { listAutoresearchManagedPaths, type ResolvedAutoresearchPaths } from "../core/paths"
import type { AutoresearchState } from "../core/types"

export interface AutoresearchDurabilityIssue {
  code: "invalid_jsonl" | "invalid_state_snapshot" | "missing_jsonl" | "stale_state_snapshot"
  message: string
  recovery?: string
  severity: "error" | "warning"
}

export interface AutoresearchDurabilityStatus {
  backupCount: number
  degraded: boolean
  issues: AutoresearchDurabilityIssue[]
  requiresRecovery: boolean
}

export interface AutoresearchBackupEntry {
  createdAt: string
  files: Array<{
    path: string
    sizeBytes?: number
  }>
  id: string
}

export interface AutoresearchJsonlInspection {
  invalidLineNumbers: number[]
  state: AutoresearchState
}

const AUTORESEARCH_BACKUP_KEEP = 5

export function createEmptyAutoresearchDurabilityStatus(): AutoresearchDurabilityStatus {
  return {
    backupCount: 0,
    degraded: false,
    issues: [],
    requiresRecovery: false,
  }
}

export function inspectAutoresearchJsonl(content: string): AutoresearchJsonlInspection {
  const invalidLineNumbers: number[] = []
  const lines = content.split(/\r?\n/u)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line?.trim()) continue
    if (!parseJsonlLine(line)) {
      invalidLineNumbers.push(index + 1)
    }
  }

  return {
    invalidLineNumbers,
    state: reconstructJsonlState(content),
  }
}

export function parseStateSnapshot(text: string | undefined): AutoresearchState | undefined {
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

export async function getAutoresearchDurabilityStatus(input: {
  jsonlText?: string
  paths: ResolvedAutoresearchPaths
  stateText?: string
}): Promise<AutoresearchDurabilityStatus> {
  const [backups, existingArtifacts] = await Promise.all([
    listAutoresearchBackups(input.paths),
    listExistingArtifacts(input.paths),
  ])
  const issues: AutoresearchDurabilityIssue[] = []
  const backupCount = backups.length
  const snapshotState = parseStateSnapshot(input.stateText)
  const hasSessionContext = existingArtifacts.some((artifact) => artifact !== path.basename(input.paths.backupsDirectory)) || backupCount > 0

  if (!input.jsonlText) {
    if (hasSessionContext) {
      issues.push({
        code: "missing_jsonl",
        message: "autoresearch.jsonl is missing, so the source-of-truth session history cannot be trusted.",
        recovery: backupCount > 0
          ? "Use autoresearch action=backups to inspect saved backups and action=restore to recover one before resuming the loop."
          : "No backups were found. Reinitialize with init_experiment or autoresearch_create if you intend to start a fresh session.",
        severity: "error",
      })
    }
  } else {
    const inspection = inspectAutoresearchJsonl(input.jsonlText)
    if (inspection.invalidLineNumbers.length > 0) {
      issues.push({
        code: "invalid_jsonl",
        message: `autoresearch.jsonl contains invalid JSONL entries on line(s) ${inspection.invalidLineNumbers.join(", ")}.`,
        recovery: backupCount > 0
          ? "Restore a previous backup before continuing the loop, or manually repair the corrupted lines if you know the intended content."
          : "Repair or replace autoresearch.jsonl before continuing; no backups are currently available.",
        severity: "error",
      })
    }
  }

  if (input.stateText && !snapshotState) {
    issues.push({
      code: "invalid_state_snapshot",
      message: "autoresearch.state.json could not be parsed and may be stale or corrupted.",
      recovery: "Regenerate the state snapshot by restoring a healthy JSONL file and re-running any autoresearch write operation.",
      severity: "warning",
    })
  }

  if (input.jsonlText && snapshotState) {
    const normalizedJsonlState = inspectAutoresearchJsonl(input.jsonlText).state
    if (
      snapshotState.runs.length !== normalizedJsonlState.runs.length
      || snapshotState.currentSegment !== normalizedJsonlState.currentSegment
      || snapshotState.lastUpdatedAt !== normalizedJsonlState.lastUpdatedAt
    ) {
      issues.push({
        code: "stale_state_snapshot",
        message: "autoresearch.state.json does not match autoresearch.jsonl and will be treated as stale derived state.",
        recovery: "Any successful autoresearch write will regenerate the state snapshot from JSONL.",
        severity: "warning",
      })
    }
  }

  return {
    backupCount,
    degraded: issues.length > 0,
    issues,
    requiresRecovery: issues.some((issue) => issue.severity === "error"),
  }
}

export async function createAutoresearchBackup(paths: ResolvedAutoresearchPaths, reason = "manual"): Promise<AutoresearchBackupEntry | undefined> {
  const artifacts = await existingManagedArtifacts(paths)
  if (artifacts.length === 0) return undefined

  const id = createBackupId(reason)
  const destinationRoot = path.join(paths.backupsDirectory, id)
  await mkdir(destinationRoot, { recursive: true })

  const files: AutoresearchBackupEntry["files"] = []
  for (const artifactPath of artifacts) {
    const relativePath = path.relative(paths.directory, artifactPath) || path.basename(artifactPath)
    const destination = path.join(destinationRoot, relativePath)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(artifactPath, destination, { recursive: true })

    const artifactStats = await stat(artifactPath)
    files.push({
      path: relativePath.replaceAll("\\", "/"),
      sizeBytes: artifactStats.isDirectory() ? undefined : artifactStats.size,
    })
  }

  await cleanupAutoresearchBackups(paths)
  return {
    createdAt: backupIdToIsoString(id),
    files,
    id,
  }
}

export async function listAutoresearchBackups(paths: ResolvedAutoresearchPaths): Promise<AutoresearchBackupEntry[]> {
  let entries
  try {
    entries = await readdir(paths.backupsDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  const backups: AutoresearchBackupEntry[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const backupRoot = path.join(paths.backupsDirectory, entry.name)
    const files = await listBackupFiles(backupRoot, backupRoot)
    backups.push({
      createdAt: backupIdToIsoString(entry.name),
      files,
      id: entry.name,
    })
  }

  return backups.sort((left, right) => right.id.localeCompare(left.id))
}

export async function restoreAutoresearchBackup(
  paths: ResolvedAutoresearchPaths,
  backupId?: string,
): Promise<AutoresearchBackupEntry> {
  const backups = await listAutoresearchBackups(paths)
  const backup = backupId
    ? backups.find((item) => item.id === backupId)
    : backups[0]

  if (!backup) {
    throw new Error(backupId
      ? `Backup ${backupId} was not found for this autoresearch session.`
      : "No autoresearch backups are available to restore.")
  }

  await clearLiveAutoresearchArtifacts(paths)

  const backupRoot = path.join(paths.backupsDirectory, backup.id)
  for (const file of backup.files) {
    const source = path.join(backupRoot, file.path)
    const destination = path.join(paths.directory, file.path)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true })
  }

  return backup
}

export function formatAutoresearchDurabilityReport(status: AutoresearchDurabilityStatus): string | undefined {
  if (!status.degraded && status.backupCount === 0) return undefined

  return [
    status.requiresRecovery ? "Durability: recovery required." : status.degraded ? "Durability: warnings detected." : "Durability: healthy.",
    ...status.issues.map((issue) => `- ${issue.message}${issue.recovery ? ` ${issue.recovery}` : ""}`),
    `- Backups available: ${status.backupCount}.`,
  ].join("\n")
}

export function formatAutoresearchRecoveryMessage(status: AutoresearchDurabilityStatus, action: string): string | undefined {
  if (!status.requiresRecovery) return undefined

  return [
    `Autoresearch session recovery is required before ${action}.`,
    ...status.issues.filter((issue) => issue.severity === "error").map((issue) => `- ${issue.message}${issue.recovery ? ` ${issue.recovery}` : ""}`),
    `- Backups available: ${status.backupCount}.`,
  ].join("\n")
}

async function listExistingArtifacts(paths: ResolvedAutoresearchPaths): Promise<string[]> {
  const managedPaths = listAutoresearchManagedPaths(paths, { includeBackups: true })
  const artifacts: string[] = []

  for (const managedPath of managedPaths) {
    if (await pathExists(managedPath)) {
      artifacts.push(path.relative(paths.directory, managedPath) || path.basename(managedPath))
    }
  }

  return artifacts.map((artifact) => artifact.replaceAll("\\", "/"))
}

async function existingManagedArtifacts(paths: ResolvedAutoresearchPaths): Promise<string[]> {
  const managedPaths = listAutoresearchManagedPaths(paths)
  const existing: string[] = []

  for (const managedPath of managedPaths) {
    if (await pathExists(managedPath)) {
      existing.push(managedPath)
    }
  }

  return existing
}

async function clearLiveAutoresearchArtifacts(paths: ResolvedAutoresearchPaths): Promise<void> {
  await Promise.all(listAutoresearchManagedPaths(paths).map(async (managedPath) => {
    await rm(managedPath, { force: true, recursive: true }).catch(() => undefined)
  }))
}

async function cleanupAutoresearchBackups(paths: ResolvedAutoresearchPaths): Promise<void> {
  const backups = await listAutoresearchBackups(paths)
  for (const backup of backups.slice(AUTORESEARCH_BACKUP_KEEP)) {
    await rm(path.join(paths.backupsDirectory, backup.id), { force: true, recursive: true }).catch(() => undefined)
  }
}

async function listBackupFiles(root: string, current: string): Promise<AutoresearchBackupEntry["files"]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: AutoresearchBackupEntry["files"] = []

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listBackupFiles(root, absolutePath))
      continue
    }

    const fileStats = await stat(absolutePath)
    files.push({
      path: path.relative(root, absolutePath).replaceAll("\\", "/"),
      sizeBytes: fileStats.size,
    })
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function createBackupId(reason: string): string {
  const stamp = new Date().toISOString().replace(/[-:.]/gu, "")
  const safeReason = reason.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "manual"
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${safeReason}-${suffix}`
}

function backupIdToIsoString(id: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(id)
  if (!match) return new Date().toISOString()
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}