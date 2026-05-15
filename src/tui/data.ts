import type { ResolvedAutoresearchPaths } from "../core/paths"
import type { AutoresearchState } from "../core/types"
import type { AutoresearchDurabilityStatus } from "../server/durability"
import { loadAutoresearchSession } from "../server/storage"

export interface AutoresearchWorkspaceSnapshot {
  durability?: AutoresearchDurabilityStatus
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
  const session = await loadAutoresearchSession(projectDir, preferredWorkDir)
  const hasVisibleState = Boolean(
    session.state.config
      || session.state.runs.length > 0
      || session.state.hooks.length > 0
      || session.state.notes.length > 0
      || session.notesText?.trim()
      || session.ideasText?.trim(),
  )

  if (!hasVisibleState && !session.durability.degraded && session.durability.backupCount === 0) {
    return undefined
  }

  return {
    durability: session.durability,
    ideasText: session.ideasText,
    notesText: session.notesText,
    paths: session.paths,
    projectDir,
    state: session.state,
  }
}