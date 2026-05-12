import type { PluginModule } from "@opencode-ai/plugin"
import { buildAutoresearchCompactionSummary } from "../core/compaction"
import { injectAutoresearchConfig, type MutablePluginConfig } from "./commands"
import { loadAutoresearchSession } from "./storage"
import { runtimeStore } from "./runtime"
import { createAutoresearchTools } from "./tools"

const plugin: PluginModule = {
  id: "opencode.autoresearch",
  server: async (input) => {
    return {
      tool: createAutoresearchTools(input),
      config: async (cfg) => {
        injectAutoresearchConfig(cfg as MutablePluginConfig)
      },
      event: async ({ event }) => {
        const sessionId = getEventSessionID(event)
        if (!sessionId) return

        if (event.type === "session.idle") {
          if (!runtimeStore.shouldResume(sessionId)) return
          const runtime = runtimeStore.get(sessionId)
          const session = await loadAutoresearchSession(input.directory, runtime?.workDir)
          const lastRun = session.state.runs.at(-1)
          const maxIterations = session.state.config?.maxIterations
          const atLimit = Boolean(maxIterations && lastRun && lastRun.iteration >= maxIterations)
          if (session.state.mode !== "active" || !lastRun || atLimit) {
            runtimeStore.resetLoop(sessionId)
            return
          }

          runtimeStore.consumeAutoResume(sessionId)
          await input.client.session.promptAsync({
            body: {
              parts: [
                {
                  type: "text",
                  text: [
                    "Continue the autoresearch loop.",
                    "Review the latest run in autoresearch.jsonl, decide whether to keep, discard, or retry it, and only then start the next iteration if it is justified.",
                  ].join(" "),
                },
              ],
            },
            path: {
              id: sessionId,
            },
            query: {
              directory: input.directory,
            },
          })
          return
        }

        runtimeStore.touch(sessionId)
      },
      "experimental.chat.system.transform": async ({ sessionID }, output) => {
        if (!sessionID) return
        const session = await loadAutoresearchSession(input.directory)
        if (!session.state.config) return

        output.system.push(
          [
            "Autoresearch session is active for this project.",
            `Mode: ${session.state.mode}.`,
            `Session name: ${session.state.config.name}.`,
            `Primary command: ${session.state.config.command}.`,
            "Prefer the autoresearch tools for initialization, running benchmarks, logging keep or discard decisions, and session control.",
          ].join(" "),
        )
      },
      "experimental.session.compacting": async ({ sessionID }, output) => {
        const runtime = runtimeStore.get(sessionID)
        const session = await loadAutoresearchSession(input.directory, runtime?.workDir)
        if (!session.state.config) return

        output.prompt = [
          "Summarize the autoresearch session deterministically.",
          "Preserve the current objective, latest run results, kept versus discarded decisions, checks state, and the next concrete experiment step.",
          "Use the following exact state as the source of truth:",
          "",
          buildAutoresearchCompactionSummary({
            ideasText: session.ideasText,
            notesText: session.notesText,
            state: session.state,
          }),
        ].join("\n")
      },
      "experimental.compaction.autocontinue": async ({ sessionID }, output) => {
        const runtime = runtimeStore.get(sessionID)
        output.enabled = runtime?.mode === "active" ? true : false
      },
    }
  },
}

export default plugin

function getEventSessionID(event: { type: string; properties?: Record<string, unknown> }): string | undefined {
  return typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined
}
