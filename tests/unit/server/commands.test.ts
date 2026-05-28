import { describe, expect, it } from "bun:test"
import {
  AUTORESEARCH_AGENT,
  createAutoresearchCommands,
  injectAutoresearchConfig,
  type MutablePluginConfig,
} from "../../../src/server/commands"

describe("injectAutoresearchConfig", () => {
  it("orders primary agents as build, plan, then autoresearch", () => {
    const cfg: MutablePluginConfig = {
      agent: {
        review: {
          description: "Review-only agent.",
          mode: "subagent",
        },
      },
    }

    injectAutoresearchConfig(cfg)

    expect(Object.keys(cfg.agent ?? {})).toEqual(["build", "plan", AUTORESEARCH_AGENT, "review"])
    expect(cfg.agent?.build).toEqual({ mode: "primary" })
    expect(cfg.agent?.plan).toEqual({ mode: "primary" })
  })

  it("preserves existing build, plan, and autoresearch agent overrides", () => {
    const customAutoresearch = {
      description: "Custom autoresearch prompt.",
      mode: "primary" as const,
      prompt: "Use the custom prompt.",
    }

    const cfg: MutablePluginConfig = {
      agent: {
        [AUTORESEARCH_AGENT]: customAutoresearch,
        build: {
          prompt: "Custom build prompt.",
        },
        plan: {
          prompt: "Custom plan prompt.",
        },
      },
      command: {
        autoresearch: {
          template: "Keep the existing command template.",
        },
      },
    }

    injectAutoresearchConfig(cfg)

    expect(cfg.agent?.build).toEqual({ prompt: "Custom build prompt." })
    expect(cfg.agent?.plan).toEqual({ prompt: "Custom plan prompt." })
    expect(cfg.agent?.[AUTORESEARCH_AGENT]).toBe(customAutoresearch)
    expect(cfg.command?.autoresearch).toEqual({ template: "Keep the existing command template." })
    expect(cfg.command?.["autoresearch-create"]).toEqual(createAutoresearchCommands()["autoresearch-create"])
  })
})