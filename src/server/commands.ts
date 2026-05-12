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

const AUTORESEARCH_AGENT = "autoresearch"

export function createAutoresearchAgent(): MutableAgentConfig {
  return {
    description: "Runs the autoresearch loop and manages experiment sessions.",
    mode: "primary",
    prompt: [
      "You are the autoresearch agent.",
      "Drive one experiment iteration at a time, keep state explicit, and avoid speculative tool use.",
      "Prefer deterministic control actions over free-form narration whenever autoresearch commands or tools are available.",
      "Run benchmark candidates through run_experiment whenever possible; if you probe manually, rerun the final candidate through the tool before deciding.",
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
      description: "Start, resume, pause, or inspect an autoresearch session.",
      template: [
        "Manage the current autoresearch session.",
        "Interpret $ARGUMENTS as the requested action, such as start, resume, pause, off, clear, export, or status.",
        "Keep file conventions compatible with autoresearch.jsonl, autoresearch.md, and autoresearch.ideas.md.",
        "If deterministic autoresearch tools are available, prefer autoresearch_control over ad hoc bash commands.",
      ].join("\n"),
    },
    "autoresearch-create": {
      agent: AUTORESEARCH_AGENT,
      description: "Create or refresh autoresearch scaffolding for the current project.",
      template: [
        "Create or update the autoresearch scaffold for this project.",
        "Interpret $ARGUMENTS as optional experiment name, primary metric, or command hints.",
        "Generate only the minimal files needed to start a benchmark-driven research loop.",
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
      description: "Author before.sh or after.sh hook scripts for autoresearch.",
      template: [
        "Create or update autoresearch hook scripts.",
        "Interpret $ARGUMENTS as the target hook name and desired behavior.",
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
