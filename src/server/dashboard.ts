import { loadAutoresearchSession, writeDashboard } from "./storage"

export async function exportDashboard(projectDir: string, configuredWorkDir?: string): Promise<{ path: string }> {
  const session = await loadAutoresearchSession(projectDir, configuredWorkDir)
  if (!session.state.config) {
    throw new Error("No autoresearch session found to export.")
  }

  const filePath = await writeDashboard(session.paths, session.state, session.notesText, session.ideasText, projectDir)
  return { path: filePath }
}
