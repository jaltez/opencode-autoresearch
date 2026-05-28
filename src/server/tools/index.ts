import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin/tool"
import { AUTORESEARCH_AGENT, isAutoresearchAgent } from "../commands"
import { runtimeStore } from "../runtime"
import { controlTool } from "./control"
import { autoresearchCreateTool } from "./create"
import { autoresearchFinalizeTool } from "./finalize"
import { autoresearchHooksTool } from "./hooks"
import { initExperimentTool } from "./init-experiment"
import { logExperimentTool } from "./log-experiment"
import { createRunExperimentTool } from "./run-experiment"

const AUTORESEARCH_AGENT_ONLY_MESSAGE = `This tool is only available when the active agent is ${AUTORESEARCH_AGENT}.`

export function createAutoresearchTools(_input: PluginInput): NonNullable<Hooks["tool"]> {
  return {
    autoresearch_control: restrictToAutoresearchAgent(controlTool),
    autoresearch_create: restrictToAutoresearchAgent(autoresearchCreateTool),
    autoresearch_finalize: restrictToAutoresearchAgent(autoresearchFinalizeTool),
    autoresearch_hooks: restrictToAutoresearchAgent(autoresearchHooksTool),
    init_experiment: restrictToAutoresearchAgent(initExperimentTool),
    log_experiment: restrictToAutoresearchAgent(logExperimentTool),
    run_experiment: restrictToAutoresearchAgent(createRunExperimentTool()),
  }
}

function restrictToAutoresearchAgent(definition: ToolDefinition): ToolDefinition {
  return {
    ...definition,
    async execute(args, context) {
      if (!isAutoresearchAgent(context.agent)) {
        return AUTORESEARCH_AGENT_ONLY_MESSAGE
      }

      runtimeStore.setAgent(context.sessionID, context.agent)
      return await definition.execute(args, context)
    },
  }
}
