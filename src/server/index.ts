import type { PluginModule } from "@opencode-ai/plugin"
import { buildAutoresearchCompactionSummary } from "../core/compaction"
import { AUTORESEARCH_CANONICAL_COMMAND } from "../core/session-config"
import { injectAutoresearchConfig, type MutablePluginConfig } from "./commands"
import { formatAutoresearchDurabilityReport } from "./durability"
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
          if (session.durability.requiresRecovery) {
            runtimeStore.resetLoop(sessionId)
            return
          }
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
                    "Use autoresearch.ideas.md for deferred candidates and prefer the canonical autoresearch.sh entrypoint when it exists.",
                    "Log durable ASI for any run that changes your understanding of the search space.",
                    "Be careful not to overfit to the benchmarks and do not cheat on the benchmarks.",
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
        const runtime = runtimeStore.get(sessionID)
        const session = await loadAutoresearchSession(input.directory, runtime?.workDir)
        const durabilityReport = formatAutoresearchDurabilityReport(session.durability)
        if (durabilityReport) {
          output.system.push(durabilityReport)
        }
        if (!session.state.config) return

        const benchmarkCommand = session.state.config.benchmarkCommand
          ? ` Benchmark delegate: ${session.state.config.benchmarkCommand}.`
          : ""

        output.system.push(
          [
            "Autoresearch session is active for this project.",
            `Mode: ${session.state.mode}.`,
            `Session name: ${session.state.config.name}.`,
            `Primary command: ${session.state.config.command}.`,
            benchmarkCommand.trim(),
            `Read autoresearch.md for the session contract and use ${AUTORESEARCH_CANONICAL_COMMAND} as the benchmark entrypoint when it exists.`,
            "Use autoresearch.ideas.md to keep deferred but promising hypotheses alive across compaction or reverts.",
            "Persist ASI with log_experiment so discarded or retried runs leave behind reusable diagnostic memory.",
            "Finish the current run_experiment plus log_experiment cycle before pivoting to unrelated user input.",
            "Before keeping a run, ensure the winning change is applied to the intended implementation, rerun validation at the default target configuration, then log the decision.",
            "Be careful not to overfit to the benchmarks and do not cheat on the benchmarks.",
            "Prefer the autoresearch tools for initialization, running benchmarks, logging keep or discard decisions, and session control.",
          ].filter(Boolean).join(" "),
        )
      },
      "experimental.session.compacting": async ({ sessionID }, output) => {
        const runtime = runtimeStore.get(sessionID)
        const session = await loadAutoresearchSession(input.directory, runtime?.workDir)
        if (!session.state.config) return

        output.prompt = [
          "Summarize the autoresearch session deterministically.",
          "Preserve the current objective, latest run results, kept versus discarded decisions, checks state, and the next concrete experiment step.",
          "Be careful not to overfit to the benchmarks and do not cheat on the benchmarks.",
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
