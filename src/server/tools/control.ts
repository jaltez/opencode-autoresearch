import { tool } from "@opencode-ai/plugin"
import { buildAutoresearchCompactionSummary } from "../../core/compaction"
import { exportDashboard } from "../dashboard"
import { appendJsonlEntry, loadAutoresearchSession, removeAutoresearchFiles, writeStateSnapshot } from "../storage"
import { runtimeStore } from "../runtime"

export const controlTool = tool({
  description: "Control the autoresearch session mode, export state, clear files, or inspect the current session.",
  args: {
    action: tool.schema.enum(["clear", "export", "off", "pause", "resume", "status"]),
    deleteFiles: tool.schema.boolean().optional(),
    reason: tool.schema.string().optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: `Autoresearch ${args.action}` })

    const workDir = args.workDir ?? runtimeStore.get(context.sessionID)?.workDir
    const session = await loadAutoresearchSession(context.directory, workDir)
    switch (args.action) {
      case "status": {
        const summary = buildAutoresearchCompactionSummary({
          ideasText: session.ideasText,
          notesText: session.notesText,
          state: session.state,
        })
        return summary
      }
      case "export": {
        const exported = await exportDashboard(context.directory, workDir)
        return `Exported autoresearch dashboard to ${exported.path}`
      }
      case "clear": {
        runtimeStore.clear(context.sessionID)
        if (args.deleteFiles) {
          await removeAutoresearchFiles(session.paths)
          return "Cleared autoresearch runtime state and deleted autoresearch files."
        }
        return "Cleared autoresearch runtime state. Pass deleteFiles=true to remove session files."
      }
      case "off":
      case "pause":
      case "resume": {
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
