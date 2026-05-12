import { afterEach, describe, expect, it } from "bun:test"
import path from "node:path"
import { loadAutoresearchSession } from "../../src/server/storage"
import { runtimeStore } from "../../src/server/runtime"
import { autoresearchCreateTool } from "../../src/server/tools/create"
import { autoresearchFinalizeTool } from "../../src/server/tools/finalize"
import { autoresearchHooksTool } from "../../src/server/tools/hooks"
import { initExperimentTool } from "../../src/server/tools/init-experiment"
import { logExperimentTool } from "../../src/server/tools/log-experiment"
import { createRunExperimentTool } from "../../src/server/tools/run-experiment"
import { createFixtureWorkspace, createToolContext, readText } from "./helpers"

afterEach(() => {
  for (const runtime of runtimeStore.list()) {
    runtimeStore.clear(runtime.sessionId)
  }
})

describe("server workflows integration", () => {
  it("creates scaffold files, infers bun test, and writes hook templates", async () => {
    const workspace = await createFixtureWorkspace("basic-project")
    const context = createToolContext(workspace)

    const createResult = await autoresearchCreateTool.execute(
      {
        createHooks: true,
        objective: "Measure test command quality.",
        primaryMetric: "accuracy",
      },
      context,
    )

    expect(typeof createResult).toBe("object")
    const session = await loadAutoresearchSession(workspace)
    expect(session.state.config?.command).toBe("bun test")
    expect(await Bun.file(path.join(workspace, "autoresearch.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(workspace, "autoresearch.ideas.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(workspace, "before.sh")).exists()).toBe(true)
    expect(await Bun.file(path.join(workspace, "after.sh")).exists()).toBe(true)
    expect((await readText(path.join(workspace, "before.sh"))).includes("before hook ok")).toBe(true)
  })

  it("can scaffold hooks independently without overwriting existing files", async () => {
    const workspace = await createFixtureWorkspace("basic-project")
    const context = createToolContext(workspace)

    await autoresearchHooksTool.execute({ kind: "before", instructions: "Run lightweight lint checks." }, context)
    const first = await readText(path.join(workspace, "before.sh"))
    expect(first).toContain("Run lightweight lint checks.")

    await autoresearchHooksTool.execute({ kind: "before" }, context)
    const second = await readText(path.join(workspace, "before.sh"))
    expect(second).toBe(first)
  })

  it("builds finalize groups and creates isolated review branches for non-overlapping kept runs", async () => {
    const workspace = await createFixtureWorkspace("finalize-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "finalize-benchmark",
        objective: "Split kept runs into reviewable branches.",
      },
      context,
    )

    await runExperimentTool.execute({ summary: "Improve feature A." }, context)
    await logExperimentTool.execute({ decision: "keep", summary: "Keep feature A change." }, context)
    await runExperimentTool.execute({ summary: "Improve feature B." }, context)
    await logExperimentTool.execute({ decision: "keep", summary: "Keep feature B change." }, context)

    const finalizeResult = await autoresearchFinalizeTool.execute({ createBranches: true, prefix: "review" }, context)
    if (
      typeof finalizeResult === "string"
      || !finalizeResult.metadata
      || !Array.isArray((finalizeResult.metadata as { createdBranches?: unknown }).createdBranches)
    ) {
      throw new Error(`Expected finalize metadata, got string output: ${finalizeResult}`)
    }
    const createdBranches = finalizeResult.metadata.createdBranches as string[]
    expect(createdBranches).toHaveLength(2)

    const [branchA, branchB] = createdBranches
    const branchNames = (await Bun.$`git for-each-ref refs/heads/review ${"--format=%(refname:short)"}`.cwd(workspace).text())
      .split("\n")
      .map((line) => line.replace(/^[*\s]+/, "").trim())
      .filter(Boolean)
    expect(branchNames).toEqual([branchA, branchB])

    const featureAOnA = (await Bun.$`git show ${branchA}:feature-a.txt`.cwd(workspace).text()).trim()
    const featureBOnA = (await Bun.$`git show ${branchA}:feature-b.txt`.cwd(workspace).text()).trim()
    const featureAOnB = (await Bun.$`git show ${branchB}:feature-a.txt`.cwd(workspace).text()).trim()
    const featureBOnB = (await Bun.$`git show ${branchB}:feature-b.txt`.cwd(workspace).text()).trim()

    expect(featureAOnA).toBe("improved-a")
    expect(featureBOnA).toBe("baseline-b")
    expect(featureAOnB).toBe("baseline-a")
    expect(featureBOnB).toBe("improved-b")
  })
})
