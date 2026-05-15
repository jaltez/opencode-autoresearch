import { tool } from "@opencode-ai/plugin"
import { buildAutoresearchCompactionSummary } from "../../core/compaction"
import { exportDashboard } from "../dashboard"
import {
  createAutoresearchBackup,
  formatAutoresearchDurabilityReport,
  formatAutoresearchRecoveryMessage,
  listAutoresearchBackups,
  restoreAutoresearchBackup,
} from "../durability"
import { appendJsonlEntry, loadAutoresearchSession, removeAutoresearchFiles, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export const controlTool = tool({
  description: "Control the autoresearch session mode, export state, clear files, inspect durability, and manage backups.",
  args: {
    action: tool.schema.enum(["backup", "backups", "clear", "export", "off", "pause", "restore", "resume", "status"]),
    backupId: tool.schema.string().optional(),
    deleteFiles: tool.schema.boolean().optional(),
    reason: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: `Autoresearch ${args.action}` })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    switch (args.action) {
      case "backup": {
        const backup = await createAutoresearchBackup(session.paths, args.reason ?? "manual")
        if (!backup) {
          return "No autoresearch files were present to back up."
        }
        return `Created backup ${backup.id} with ${backup.files.length} artifact${backup.files.length === 1 ? "" : "s"}.`
      }
      case "backups": {
        const backups = await listAutoresearchBackups(session.paths)
        if (backups.length === 0) {
          return "No autoresearch backups are available for this session."
        }

        return backups.map((backup, index) => {
          const marker = index === 0 ? "latest" : "saved"
          return `${backup.id} (${marker}, ${backup.files.length} artifact${backup.files.length === 1 ? "" : "s"}, ${backup.createdAt})`
        }).join("\n")
      }
      case "status": {
        const summary = buildAutoresearchCompactionSummary({
          ideasText: session.ideasText,
          notesText: session.notesText,
          state: session.state,
        })
        return [formatAutoresearchDurabilityReport(session.durability), summary].filter(Boolean).join("\n\n")
      }
      case "export": {
        const exported = await exportDashboard(context.directory, workDir)
        return `Exported autoresearch dashboard to ${exported.path}`
      }
      case "clear": {
        runtimeStore.clear(context.sessionID)
        if (args.deleteFiles) {
          const backup = await createAutoresearchBackup(session.paths, args.reason ?? "before-clear")
          await removeAutoresearchFiles(session.paths)
          return backup
            ? `Cleared autoresearch runtime state, deleted live autoresearch files, and preserved backup ${backup.id}.`
            : "Cleared autoresearch runtime state and deleted live autoresearch files."
        }
        return "Cleared autoresearch runtime state. Pass deleteFiles=true to remove session files."
      }
      case "restore": {
        const preRestoreBackup = await createAutoresearchBackup(session.paths, "before-restore")
        const restored = await restoreAutoresearchBackup(session.paths, args.backupId)
        const nextSession = await loadAutoresearchSession(context.directory, workDir)
        if (nextSession.state.config) {
          runtimeStore.activate(context.sessionID, nextSession.paths.directory)
          runtimeStore.setMode(context.sessionID, nextSession.state.mode)
        } else {
          runtimeStore.clear(context.sessionID)
        }
        if (!nextSession.durability.requiresRecovery) {
          await writeStateSnapshot(nextSession.paths, nextSession.state)
        }

        return [
          `Restored autoresearch backup ${restored.id}.${preRestoreBackup ? ` Current live files were first preserved as ${preRestoreBackup.id}.` : ""}`,
          formatAutoresearchDurabilityReport(nextSession.durability),
        ].filter(Boolean).join("\n\n")
      }
      case "off":
      case "pause":
      case "resume": {
        const recoveryMessage = formatAutoresearchRecoveryMessage(
          session.durability,
          args.action === "resume" ? "resuming the session" : `switching autoresearch ${args.action}`,
        )
        if (recoveryMessage) {
          return recoveryMessage
        }

        const mode = args.action === "off" ? "off" : args.action === "pause" ? "paused" : "active"
        runtimeStore.setMode(context.sessionID, mode)
        if (mode !== "active") runtimeStore.resetLoop(context.sessionID)
        await appendJsonlEntry(session.paths, {
          at: new Date().toISOString(),
          mode,
          reason: args.reason,
          type: "mode",
        })
        const nextSession = await loadAutoresearchSession(context.directory, workDir)
        await writeStateSnapshot(nextSession.paths, nextSession.state)
        return `Autoresearch mode set to ${mode}.`
      }
    }
  },
})
