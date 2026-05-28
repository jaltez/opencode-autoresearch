export interface MutableAgentConfig {
  description: string
  mode?: "all" | "primary" | "subagent"
  prompt?: string
  tools?: Record<string, boolean>
}

export interface MutableCommandConfig {
  agent?: string
  description?: string
  model?: string
  subtask?: boolean
  template: string
}

export interface MutablePluginConfig {
  agent?: Record<string, MutableAgentConfig>
  command?: Record<string, MutableCommandConfig>
  default_agent?: string
}

export const AUTORESEARCH_AGENT = "autoresearch"

export function isAutoresearchAgent(agent: string | undefined): boolean {
  return agent === AUTORESEARCH_AGENT
}

export function createAutoresearchAgent(): MutableAgentConfig {
  return {
    description: "Runs the autoresearch loop and manages experiment sessions.",
    mode: "primary",
    prompt: [
      "You are the autoresearch agent.",
      "Drive one experiment iteration at a time, keep state explicit, and avoid speculative tool use.",
      "Prefer deterministic control actions over free-form narration whenever autoresearch commands or tools are available.",
      "Read autoresearch.md at the start of the session, use autoresearch.ideas.md as the backlog for deferred hypotheses, and keep the loop benchmark-driven.",
      "When autoresearch.sh exists, treat it as the canonical benchmark entrypoint and use run_experiment instead of ad hoc commands.",
      "If the user sends an unrelated message while an experiment is in flight, finish the current run_experiment plus log_experiment cycle before pivoting.",
      "Use log_experiment to persist durable ASI for every meaningful run, especially discarded, retried, or crashed experiments.",
      "Before keeping a run, make sure the winning change is present in the intended implementation, validated at the default target configuration, and logged with log_experiment.",
    ].join("\n"),
    tools: {
      bash: true,
      edit: true,
      glob: true,
      grep: true,
      lsp: true,
      read: true,
      write: true,
    },
  }
}

export function createAutoresearchCommands(): Record<string, MutableCommandConfig> {
  return {
    autoresearch: {
      agent: AUTORESEARCH_AGENT,
      description: "Start, resume, pause, inspect, back up, or restore an autoresearch session.",
      template: [
        "Manage the current autoresearch session.",
        "Interpret $ARGUMENTS as the requested action, such as start, resume, pause, off, clear, export, status, backup, backups, or restore.",
        "Keep file conventions compatible with autoresearch.jsonl, autoresearch.md, autoresearch.ideas.md, autoresearch.sh, and autoresearch.config.json.",
        "If the session is degraded, prioritize backup, backups, restore, or reinitialization before more loop mutations.",
        "If deterministic autoresearch tools are available, prefer autoresearch_control over ad hoc bash commands.",
      ].join("\n"),
    },
    "autoresearch-create": {
      agent: AUTORESEARCH_AGENT,
      description: "Create or refresh autoresearch scaffolding for the current project.",
      template: [
        "Create or update the autoresearch scaffold for this project.",
        "Interpret $ARGUMENTS as optional experiment name, primary metric, or command hints.",
        "Generate the canonical autoresearch scaffold, including autoresearch.md, autoresearch.sh, and related session files when needed.",
        "Prefer the autoresearch_create tool when it is available.",
      ].join("\n"),
    },
    "autoresearch-finalize": {
      agent: AUTORESEARCH_AGENT,
      description: "Prepare the kept autoresearch runs for review and branch splitting.",
      template: [
        "Review the autoresearch history and prepare a finalize plan for the kept runs.",
        "Interpret $ARGUMENTS as any scope or branch-naming hints.",
        "Do not create branches automatically without surfacing the proposed split first.",
        "Prefer the autoresearch_finalize tool when it is available.",
      ].join("\n"),
    },
    "autoresearch-hooks": {
      agent: AUTORESEARCH_AGENT,
      description: "Author before or after hook scripts for autoresearch.",
      template: [
        "Create or update autoresearch hook scripts.",
        "Interpret $ARGUMENTS as the target hook name and desired behavior.",
        "Prefer autoresearch.hooks/before.sh and autoresearch.hooks/after.sh as the primary hook locations.",
        "Keep the stdin/stdout contract machine-readable and prefer concise steer messages.",
        "Prefer the autoresearch_hooks tool when it is available.",
      ].join("\n"),
    },
  }
}

export function injectAutoresearchConfig(cfg: MutablePluginConfig): void {
  cfg.agent = cfg.agent ?? {}
  cfg.command = cfg.command ?? {}

  if (!cfg.agent[AUTORESEARCH_AGENT]) {
    cfg.agent[AUTORESEARCH_AGENT] = createAutoresearchAgent()
  }

  for (const [name, command] of Object.entries(createAutoresearchCommands())) {
    if (!cfg.command[name]) {
      cfg.command[name] = command
    }
  }
}
