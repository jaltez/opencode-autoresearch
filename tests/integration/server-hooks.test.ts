import { afterEach, describe, expect, it } from "bun:test"
import { chmod } from "node:fs/promises"
import path from "node:path"
import plugin from "../../src/server/index"
import { AUTORESEARCH_AGENT } from "../../src/server/commands"
import { loadAutoresearchSession } from "../../src/server/storage"
import { runtimeStore } from "../../src/server/runtime"
import { initExperimentTool } from "../../src/server/tools/init-experiment"
import { createRunExperimentTool } from "../../src/server/tools/run-experiment"
import { createFixtureWorkspace, createToolContext } from "./helpers"

afterEach(() => {
  for (const runtime of runtimeStore.list()) {
    runtimeStore.clear(runtime.sessionId)
  }
})

describe("server hooks integration", () => {
  it("skips hook files that are not executable", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
      },
      context,
    )
    await chmod(path.join(workspace, "before.sh"), 0o644)

    await runExperimentTool.execute({}, context)

    const session = await loadAutoresearchSession(workspace)
    expect(session.state.hooks).toHaveLength(0)
  })

  it("queues one follow-up prompt on idle when a run is waiting for continuation", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
      },
      context,
    )
    await runExperimentTool.execute({}, context)

    const promptCalls: any[] = []
    const hooks = await plugin.server({
      $: {} as never,
      client: {
        session: {
          promptAsync: async (options: unknown) => {
            promptCalls.push(options)
            return undefined as never
          },
        },
      } as never,
      directory: workspace,
      experimental_workspace: { register() {} },
      project: {} as never,
      serverUrl: new URL("http://localhost:4096"),
      worktree: workspace,
    })

    const runtime = runtimeStore.get(context.sessionID)
    if (!runtime) throw new Error("Expected active runtime")
    runtimeStore.setAgent(context.sessionID, AUTORESEARCH_AGENT)
    const updatedRuntime = runtimeStore.get(context.sessionID)
    if (!updatedRuntime) throw new Error("Expected active runtime")
    updatedRuntime.lastActivityAt = 0

    await hooks.event?.({
      event: {
        id: "evt-1",
        properties: { sessionID: context.sessionID },
        type: "session.idle",
      } as never,
    })

    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({ parts: expect.any(Array) }),
        path: { id: context.sessionID },
        query: { directory: workspace },
      }),
    )
    const promptText = promptCalls[0].body.parts.map((part: { text?: string }) => part.text ?? "").join("\n")
    expect(promptText).toContain("do not cheat on the benchmarks")

    await hooks.event?.({
      event: {
        id: "evt-2",
        properties: { sessionID: context.sessionID },
        type: "session.idle",
      } as never,
    })
    expect(promptCalls).toHaveLength(1)
  })

  it("injects autoresearch system text and deterministic compaction prompts", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Keep the workflow close to autoresearch standards.",
        primaryMetric: "accuracy",
      },
      context,
    )

    const hooks = await plugin.server({
      $: {} as never,
      client: { session: { promptAsync: async () => undefined as never } } as never,
      directory: workspace,
      experimental_workspace: { register() {} },
      project: {} as never,
      serverUrl: new URL("http://localhost:4096"),
      worktree: workspace,
    })

    runtimeStore.setAgent(context.sessionID, AUTORESEARCH_AGENT)

    const system = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.(
      {
        model: { id: "model" } as never,
        sessionID: context.sessionID,
      },
      system,
    )
    expect(system.system.join("\n")).toContain("Autoresearch session is active")
    expect(system.system.join("\n")).toContain("stable-benchmark")
    expect(system.system.join("\n")).toContain("./autoresearch.sh")
    expect(system.system.join("\n")).toContain("autoresearch.ideas.md")
    expect(system.system.join("\n")).toContain("ASI")
    expect(system.system.join("\n")).toContain("do not cheat on the benchmarks")

    const compacting = { context: [] as string[], prompt: undefined as string | undefined }
    await hooks["experimental.session.compacting"]?.({ sessionID: context.sessionID }, compacting)
    expect(compacting.prompt).toContain("Summarize the autoresearch session deterministically.")
    expect(compacting.prompt).toContain("do not cheat on the benchmarks")
    expect(compacting.prompt).toContain("## Session")
    expect(compacting.prompt).toContain("## Next Step")
  })

  it("skips autoresearch prompt injection and auto-resume outside the autoresearch agent", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
      },
      context,
    )
    await runExperimentTool.execute({}, context)

    const promptCalls: any[] = []
    const hooks = await plugin.server({
      $: {} as never,
      client: {
        session: {
          promptAsync: async (options: unknown) => {
            promptCalls.push(options)
            return undefined as never
          },
        },
      } as never,
      directory: workspace,
      experimental_workspace: { register() {} },
      project: {} as never,
      serverUrl: new URL("http://localhost:4096"),
      worktree: workspace,
    })

    runtimeStore.setAgent(context.sessionID, "build")
    const runtime = runtimeStore.get(context.sessionID)
    if (!runtime) throw new Error("Expected active runtime")
    runtime.lastActivityAt = 0

    const system = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]?.(
      {
        model: { id: "model" } as never,
        sessionID: context.sessionID,
      },
      system,
    )
    expect(system.system).toHaveLength(0)

    const compacting = { context: [] as string[], prompt: undefined as string | undefined }
    await hooks["experimental.session.compacting"]?.({ sessionID: context.sessionID }, compacting)
    expect(compacting.prompt).toBeUndefined()

    await hooks.event?.({
      event: {
        id: "evt-build-1",
        properties: { sessionID: context.sessionID },
        type: "session.idle",
      } as never,
    })

    expect(promptCalls).toHaveLength(0)
  })

  it("rejects autoresearch tools outside the autoresearch agent", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)

    const hooks = await plugin.server({
      $: {} as never,
      client: { session: { promptAsync: async () => undefined as never } } as never,
      directory: workspace,
      experimental_workspace: { register() {} },
      project: {} as never,
      serverUrl: new URL("http://localhost:4096"),
      worktree: workspace,
    })

    const result = await hooks.tool?.autoresearch_control.execute(
      { action: "status" },
      {
        ...context,
        agent: "build",
      },
    )

    expect(result).toBe(`This tool is only available when the active agent is ${AUTORESEARCH_AGENT}.`)
  })
})