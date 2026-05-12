import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { controlTool } from "./control"
import { autoresearchCreateTool } from "./create"
import { autoresearchFinalizeTool } from "./finalize"
import { autoresearchHooksTool } from "./hooks"
import { initExperimentTool } from "./init-experiment"
import { logExperimentTool } from "./log-experiment"
import { createRunExperimentTool } from "./run-experiment"

export function createAutoresearchTools(_input: PluginInput): NonNullable<Hooks["tool"]> {
  return {
    autoresearch_control: controlTool,
    autoresearch_create: autoresearchCreateTool,
    autoresearch_finalize: autoresearchFinalizeTool,
    autoresearch_hooks: autoresearchHooksTool,
    init_experiment: initExperimentTool,
    log_experiment: logExperimentTool,
    run_experiment: createRunExperimentTool(),
  }
}
