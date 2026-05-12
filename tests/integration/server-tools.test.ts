import { afterEach, describe, expect, it } from "bun:test"
import path from "node:path"
import { loadAutoresearchSession } from "../../src/server/storage"
import { runtimeStore } from "../../src/server/runtime"
import { initExperimentTool } from "../../src/server/tools/init-experiment"
import { logExperimentTool } from "../../src/server/tools/log-experiment"
import { createRunExperimentTool } from "../../src/server/tools/run-experiment"
import { createFixtureWorkspace, createToolContext, readText } from "./helpers"

afterEach(() => {
  for (const runtime of runtimeStore.list()) {
    runtimeStore.clear(runtime.sessionId)
  }
})

describe("server tools integration", () => {
  it("evaluates metric threshold checks without shell redirection artifacts", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["accuracy > 0.90"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Accept only runs above the target accuracy.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({}, context)
    const sessionAfterRun = await loadAutoresearchSession(workspace)
    expect(sessionAfterRun.state.runs[0]?.status).toBe("completed")
    expect(sessionAfterRun.state.runs[0]?.checks?.[0]?.passed).toBe(true)
    expect(sessionAfterRun.state.runs[0]?.changes?.untracked).not.toContain("0.90")
    expect(await Bun.file(path.join(workspace, "0.90")).exists()).toBe(false)
  })

  it("keeps a successful run and commits only recorded changes", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Improve accuracy without regressing latency.",
        primaryMetric: "accuracy",
      },
      context,
    )

    const runResult = await runExperimentTool.execute({ summary: "Baseline improvement attempt." }, context)
    expect(typeof runResult).toBe("object")
    const sessionAfterRun = await loadAutoresearchSession(workspace)
    const recordedRun = sessionAfterRun.state.runs[0]
    expect(recordedRun?.status).toBe("completed")
    expect(recordedRun?.metrics.map((metric) => metric.name)).toEqual(["accuracy", "latency_ms"])
    expect(sessionAfterRun.state.hooks).toHaveLength(2)
    expect(runtimeStore.get(context.sessionID)?.autoResumePending).toBe(true)
    expect(context.asked).toHaveLength(1)
    expect(context.asked[0]?.permission).toBe("bash")

    const logResult = await logExperimentTool.execute({ decision: "keep", summary: "Metric gain is good." }, context)
    expect(typeof logResult).toBe("object")
    const sessionAfterKeep = await loadAutoresearchSession(workspace)
    const keptRun = sessionAfterKeep.state.runs[0]
    expect(keptRun?.decision).toBe("keep")
    expect(keptRun?.status).toBe("kept")
    expect(typeof keptRun?.commit).toBe("string")
    expect(runtimeStore.get(context.sessionID)?.autoResumePending).toBe(false)

    const gitCount = (await Bun.$`git rev-list --count HEAD`.cwd(workspace).text()).trim()
    expect(gitCount).toBe("2")
    const appText = await readText(path.join(workspace, "app.txt"))
    expect(appText.trim()).toBe("optimized")
    expect(context.asked).toHaveLength(2)
    expect(context.asked[1]?.patterns).toEqual(["git commit"])
  })

  it("can log a nested-workdir run after runtime state is lost", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()
    const benchmarkCommand = path.join(workspace, "benchmark.sh")
    const checkCommand = path.join(workspace, "check.sh")

    await initExperimentTool.execute(
      {
        checks: [checkCommand],
        command: benchmarkCommand,
        name: "nested-workdir",
        objective: "Keep working even if runtime workdir state is gone.",
        primaryMetric: "accuracy",
        workDir: "experiments/session-a",
      },
      context,
    )

    await runExperimentTool.execute({}, context)
    runtimeStore.clear(context.sessionID)

    const logResult = await logExperimentTool.execute({ decision: "keep", summary: "Recovered via session discovery." }, context)
    expect(typeof logResult).toBe("object")

    const nestedSession = await loadAutoresearchSession(workspace, "experiments/session-a")
    expect(nestedSession.state.runs[0]?.decision).toBe("keep")
    expect(nestedSession.state.runs[0]?.status).toBe("kept")
  })

  it("marks checks failure, blocks keep, and discards changes back to baseline", async () => {
    const workspace = await createFixtureWorkspace("checks-fail")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "checks-fail",
        objective: "Do not accept changes when checks fail.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({}, context)
    const sessionAfterRun = await loadAutoresearchSession(workspace)
    expect(sessionAfterRun.state.runs[0]?.status).toBe("checks_failed")

    const keepAttempt = await logExperimentTool.execute({ decision: "keep" }, context)
    expect(keepAttempt).toBe("Cannot keep a run whose checks failed.")

    await logExperimentTool.execute({ decision: "discard" }, context)
    const sessionAfterDiscard = await loadAutoresearchSession(workspace)
    expect(sessionAfterDiscard.state.runs[0]?.decision).toBe("discard")
    expect(sessionAfterDiscard.state.runs[0]?.status).toBe("discarded")
    expect(runtimeStore.get(context.sessionID)?.autoResumePending).toBe(true)
    expect((await readText(path.join(workspace, "app.txt"))).trim()).toBe("baseline")
  })
})
