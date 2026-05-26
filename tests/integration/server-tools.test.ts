import { afterEach, describe, expect, it } from "bun:test"
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadAutoresearchSession } from "../../src/server/storage"
import { runtimeStore } from "../../src/server/runtime"
import { controlTool } from "../../src/server/tools/control"
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
    await writeFile(path.join(workspace, "after.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "payload=$(cat)",
      "[[ \"$payload\" == *'\"event\": \"after\"'* ]] || { echo 'missing after event' >&2; exit 1; }",
      "[[ \"$payload\" == *'\"decision\": \"keep\"'* ]] || { echo 'missing keep decision' >&2; exit 1; }",
      "[[ \"$payload\" == *'\"commit\":'* ]] || { echo 'missing commit' >&2; exit 1; }",
      "echo '{\"message\":\"after saw keep\"}'",
    ].join("\n"), "utf8")

    const runResult = await runExperimentTool.execute({ summary: "Baseline improvement attempt." }, context)
    expect(typeof runResult).toBe("object")
    const sessionAfterRun = await loadAutoresearchSession(workspace)
    expect(sessionAfterRun.state.config?.command).toBe("./autoresearch.sh")
    expect(sessionAfterRun.state.config?.benchmarkCommand).toBe("./benchmark.sh")
    const recordedRun = sessionAfterRun.state.runs[0]
    expect(recordedRun?.status).toBe("completed")
    expect(recordedRun?.metrics.map((metric) => metric.name)).toEqual(["accuracy", "latency_ms"])
    expect(sessionAfterRun.state.hooks).toHaveLength(1)
    expect(sessionAfterRun.state.hooks[0]?.kind).toBe("before")
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
    expect(sessionAfterKeep.state.hooks).toHaveLength(2)
    expect(sessionAfterKeep.state.hooks[1]?.kind).toBe("after")
    expect(sessionAfterKeep.state.hooks[1]?.message).toBe("after saw keep")
    expect(runtimeStore.get(context.sessionID)?.autoResumePending).toBe(true)

    const gitCount = (await Bun.$`git rev-list --count HEAD`.cwd(workspace).text()).trim()
    expect(gitCount).toBe("2")
    const commitMessage = await Bun.$`git log -1 --format=%B`.cwd(workspace).text()
    const resultTrailer = readCommitJsonTrailer<Record<string, unknown>>(commitMessage, "Autoresearch-Result")
    const metricsTrailer = readCommitJsonTrailer<Array<Record<string, unknown>>>(commitMessage, "Autoresearch-Metrics")
    expect(resultTrailer).toEqual(expect.objectContaining({
      decision: "keep",
      exitCode: 0,
      iteration: 1,
      runId: keptRun?.id,
      status: "kept",
    }))
    expect(metricsTrailer).toEqual([
      expect.objectContaining({ higherIsBetter: true, name: "accuracy", value: 0.91 }),
      expect.objectContaining({ higherIsBetter: false, name: "latency_ms", unit: "ms", value: 120 }),
    ])
    const appText = await readText(path.join(workspace, "app.txt"))
    expect(appText.trim()).toBe("optimized")
    expect(context.asked).toHaveLength(2)
    expect(context.asked[1]?.patterns).toEqual(["git commit"])
  })

  it("keeps quoted, deleted, renamed, and untracked paths with trace trailers", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()
    const quotedRelative = "quoted dir/odd 'name.txt"
    const renamedFrom = "renamed-from.txt"
    const renamedTo = "renamed dir/renamed to 'target.txt"
    const deletedRelative = "delete me.txt"
    const untrackedRelative = "new file 'added.txt"

    await mkdir(path.join(workspace, "quoted dir"), { recursive: true })
    await writeFile(path.join(workspace, quotedRelative), "baseline\n", "utf8")
    await writeFile(path.join(workspace, renamedFrom), "rename me\n", "utf8")
    await writeFile(path.join(workspace, deletedRelative), "delete me\n", "utf8")
    await Bun.$`git add -- ${quotedRelative} ${renamedFrom} ${deletedRelative}`.cwd(workspace).quiet()
    await Bun.$`git commit -m "seed edge paths"`.cwd(workspace).quiet()

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "mkdir -p \"renamed dir\"",
      "printf 'optimized\\n' > app.txt",
      "printf 'changed\\n' > \"quoted dir/odd 'name.txt\"",
      "git mv renamed-from.txt \"renamed dir/renamed to 'target.txt\"",
      "rm \"delete me.txt\"",
      "printf 'fresh\\n' > \"new file 'added.txt\"",
      "echo 'METRIC accuracy=0.93 higher'",
      "echo 'METRIC latency_ms=110 ms lower'",
    ].join("\n"), "utf8")
    await Bun.$`git add -- benchmark.sh`.cwd(workspace).quiet()
    await Bun.$`git commit -m "edge benchmark"`.cwd(workspace).quiet()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "git-edge-paths",
        objective: "Keep traceable changes across awkward paths.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({ summary: "Exercise awkward git paths." }, context)
    await logExperimentTool.execute({ decision: "keep", summary: "Keep edge path coverage." }, context)

    const session = await loadAutoresearchSession(workspace)
    const keptRun = session.state.runs[0]
    expect(keptRun?.changes?.modified).toEqual(expect.arrayContaining([quotedRelative, renamedTo, deletedRelative]))
    expect(keptRun?.changes?.untracked).toEqual(expect.arrayContaining([untrackedRelative]))
    expect(keptRun?.status).toBe("kept")
    expect(typeof keptRun?.commit).toBe("string")

    expect((await Bun.$`git show ${`HEAD:${quotedRelative}`}`.cwd(workspace).text()).trim()).toBe("changed")
    expect((await Bun.$`git show ${`HEAD:${renamedTo}`}`.cwd(workspace).text()).trim()).toBe("rename me")
    expect((await Bun.$`git show ${`HEAD:${untrackedRelative}`}`.cwd(workspace).text()).trim()).toBe("fresh")
    expect(await gitObjectExists(workspace, `HEAD:${renamedFrom}`)).toBe(false)
    expect(await gitObjectExists(workspace, `HEAD:${deletedRelative}`)).toBe(false)

    const commitMessage = await Bun.$`git log -1 --format=%B`.cwd(workspace).text()
    const resultTrailer = readCommitJsonTrailer<Record<string, unknown>>(commitMessage, "Autoresearch-Result")
    const metricsTrailer = readCommitJsonTrailer<Array<Record<string, unknown>>>(commitMessage, "Autoresearch-Metrics")
    expect(resultTrailer).toEqual(expect.objectContaining({
      decision: "keep",
      iteration: 1,
      runId: keptRun?.id,
      status: "kept",
      summary: "Keep edge path coverage.",
    }))
    expect(metricsTrailer).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "accuracy", value: 0.93 }),
      expect.objectContaining({ name: "latency_ms", unit: "ms", value: 110 }),
    ]))
  })

  it("keeps runs without requiring git when the workspace is not a repository", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()
    await rm(path.join(workspace, ".git"), { force: true, recursive: true })

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "non-git-workspace",
        objective: "Allow autoresearch in projects before git is initialized.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({}, context)
    const logResult = await logExperimentTool.execute({ decision: "keep" }, context)

    const session = await loadAutoresearchSession(workspace)
    expect(session.state.runs[0]?.decision).toBe("keep")
    expect(session.state.runs[0]?.status).toBe("kept")
    expect(session.state.runs[0]?.commit).toBeUndefined()
    expect(toolOutput(logResult)).toContain("Skipping commit because the workdir is not a git repository.")
  })

  it("leaves a run pending when git commit fails", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "git-failure",
        objective: "Do not mark a run kept when commit hooks reject it.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({}, context)
    const hookPath = path.join(workspace, ".git", "hooks", "pre-commit")
    await writeFile(hookPath, [
      "#!/usr/bin/env bash",
      "echo 'pre-commit blocked autoresearch keep' >&2",
      "exit 42",
    ].join("\n"), "utf8")
    await chmod(hookPath, 0o755)

    const logResult = await logExperimentTool.execute({ decision: "keep" }, context)

    expect(toolOutput(logResult)).toContain("Unable to keep run #1 because git commit failed.")
    expect(toolOutput(logResult)).toContain("pre-commit blocked autoresearch keep")
    const session = await loadAutoresearchSession(workspace)
    expect(session.state.runs[0]?.decision).toBe("pending")
    expect(session.state.runs[0]?.status).toBe("completed")
    expect(session.state.runs[0]?.commit).toBeUndefined()
    expect((await Bun.$`git rev-list --count HEAD`.cwd(workspace).text()).trim()).toBe("1")
  })

  it("rejects ad hoc run commands when autoresearch.sh is present", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Use the canonical benchmark entrypoint.",
        primaryMetric: "accuracy",
      },
      context,
    )

    const result = await runExperimentTool.execute({ command: "./benchmark.sh" }, context)
    expect(result).toBe([
      "autoresearch.sh exists for this session, so run_experiment must use it as the canonical entrypoint.",
      "Use ./autoresearch.sh instead of ./benchmark.sh.",
    ].join("\n"))
  })

  it("marks benchmark timeouts as crashed", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "benchmark-timeout",
        objective: "Stop runaway benchmarks.",
        primaryMetric: "accuracy",
      },
      context,
    )
    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "sleep 2",
      "echo 'METRIC accuracy=0.99 higher'",
    ].join("\n"), "utf8")

    await runExperimentTool.execute({ timeout_seconds: 0.05 }, context)

    const session = await loadAutoresearchSession(workspace)
    expect(session.state.runs[0]?.status).toBe("crashed")
    expect(session.state.runs[0]?.exitCode).toBe(124)
  })

  it("marks checks timeouts as checks_failed", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()
    const slowCheck = path.join(workspace, "slow-check.sh")
    await writeFile(slowCheck, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "sleep 2",
    ].join("\n"), "utf8")
    await chmod(slowCheck, 0o755)

    await initExperimentTool.execute(
      {
        checks: ["./slow-check.sh"],
        command: "./benchmark.sh",
        name: "checks-timeout",
        objective: "Stop runaway checks.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({ checks_timeout_seconds: 0.05 }, context)

    const session = await loadAutoresearchSession(workspace)
    expect(session.state.runs[0]?.status).toBe("checks_failed")
    expect(session.state.runs[0]?.checks?.[0]).toEqual(expect.objectContaining({
      exitCode: 124,
      passed: false,
    }))
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

  it("hydrates maxIterations from autoresearch.config.json", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Read iteration limits from the config file.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await writeFile(path.join(workspace, "autoresearch.config.json"), '{\n  "maxIterations": 1\n}\n', "utf8")

    const hydrated = await loadAutoresearchSession(workspace)
    expect(hydrated.state.config?.maxIterations).toBe(1)

    await runExperimentTool.execute({}, context)
    expect(runtimeStore.get(context.sessionID)?.autoResumePending).toBe(false)
  })

  it("persists ASI and decision-time confidence on kept runs", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Keep durable analysis for good and bad runs.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'optimized\\n' > app.txt",
      "echo 'METRIC accuracy=0.90 higher'",
      "echo 'METRIC latency_ms=120 ms lower'",
    ].join("\n"), "utf8")
    await runExperimentTool.execute({ summary: "Baseline" }, context)
    await logExperimentTool.execute({ decision: "keep", asi: '{"hypothesis":"baseline capture"}' }, context)

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'optimized\\n' > app.txt",
      "echo 'METRIC accuracy=0.91 higher'",
      "echo 'METRIC latency_ms=118 ms lower'",
    ].join("\n"), "utf8")
    await runExperimentTool.execute({ summary: "Candidate 2" }, context)
    await logExperimentTool.execute({ decision: "keep", asi: '{"hypothesis":"narrower prompt","next_action_hint":"probe retrieval only"}' }, context)

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'optimized\\n' > app.txt",
      "echo 'METRIC accuracy=0.92 higher'",
      "echo 'METRIC latency_ms=117 ms lower'",
    ].join("\n"), "utf8")
    await runExperimentTool.execute({ summary: "Candidate 3" }, context)
    const logResult = await logExperimentTool.execute({ decision: "keep", asi: '{"hypothesis":"smaller retrieval scope"}' }, context)

    expect(typeof logResult).toBe("object")
    const session = await loadAutoresearchSession(workspace)
    expect(session.state.runs).toHaveLength(3)
    expect(session.state.runs[1]?.asi).toEqual({
      hypothesis: "narrower prompt",
      next_action_hint: "probe retrieval only",
    })
    expect(session.state.runs[2]?.confidence).toBeGreaterThan(1.5)
    expect(session.state.runs[2]?.segment).toBe(1)
  })

  it("creates restorable backups and preserves them across clear deleteFiles", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Keep session artifacts recoverable after destructive clears.",
        primaryMetric: "accuracy",
      },
      context,
    )

    const backupResult = await controlTool.execute({ action: "backup" }, context)
    expect(backupResult).toContain("Created backup")

    const listResult = await controlTool.execute({ action: "backups" }, context)
    expect(listResult).toContain("manual")

    const clearResult = await controlTool.execute({ action: "clear", deleteFiles: true }, context)
    expect(clearResult).toContain("preserved backup")
    expect(await Bun.file(path.join(workspace, "autoresearch.jsonl")).exists()).toBe(false)
    expect((await stat(path.join(workspace, ".autoresearch.backups"))).isDirectory()).toBe(true)

    const restoreResult = await controlTool.execute({ action: "restore" }, context)
    expect(restoreResult).toContain("Restored autoresearch backup")
    expect(await Bun.file(path.join(workspace, "autoresearch.jsonl")).exists()).toBe(true)

    const restoredSession = await loadAutoresearchSession(workspace)
    expect(restoredSession.state.config?.name).toBe("stable-benchmark")
    expect(restoredSession.durability.requiresRecovery).toBe(false)
  })

  it("blocks loop mutations and exports recovery warnings when autoresearch.jsonl is missing", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Make degraded-state recovery explicit before running more experiments.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await controlTool.execute({ action: "backup" }, context)
    await rm(path.join(workspace, "autoresearch.jsonl"), { force: true })

    const statusResult = await controlTool.execute({ action: "status" }, context)
    expect(statusResult).toContain("Durability: recovery required.")
    expect(statusResult).toContain("autoresearch.jsonl is missing")

    const runResult = await runExperimentTool.execute({}, context)
    expect(runResult).toContain("Autoresearch session recovery is required before running a new experiment.")

    const exportResult = await controlTool.execute({ action: "export" }, context)
    expect(exportResult).toContain("autoresearch.dashboard.html")

    const html = await readText(path.join(workspace, "autoresearch.dashboard.html"))
    expect(html).toContain("Recovery Required")
    expect(html).toContain("autoresearch.jsonl is missing")
  })

  it("blocks loop mutations when autoresearch.jsonl contains invalid entries", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "invalid-jsonl",
        objective: "Require recovery before mutating corrupted session history.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await runExperimentTool.execute({}, context)
    const jsonlPath = path.join(workspace, "autoresearch.jsonl")
    await writeFile(jsonlPath, `${await readText(jsonlPath)}{not valid json}\n`, "utf8")

    const statusResult = await controlTool.execute({ action: "status" }, context)
    expect(statusResult).toContain("Durability: recovery required.")
    expect(statusResult).toContain("autoresearch.jsonl contains invalid JSONL entries")

    const runResult = await runExperimentTool.execute({}, context)
    expect(runResult).toContain("Autoresearch session recovery is required before running a new experiment.")

    const logResult = await logExperimentTool.execute({ decision: "discard" }, context)
    expect(logResult).toContain("Autoresearch session recovery is required before logging a run decision.")

    const pauseResult = await controlTool.execute({ action: "pause" }, context)
    expect(pauseResult).toContain("Autoresearch session recovery is required before switching autoresearch pause.")
  })

  it("exports an HTML dashboard with signal cards and finalize preview", async () => {
    const workspace = await createFixtureWorkspace("stable-benchmark")
    const context = createToolContext(workspace)
    const runExperimentTool = createRunExperimentTool()

    await initExperimentTool.execute(
      {
        checks: ["./check.sh"],
        command: "./benchmark.sh",
        name: "stable-benchmark",
        objective: "Export the same signal surface shown in the TUI.",
        primaryMetric: "accuracy",
      },
      context,
    )

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'optimized\\n' > app.txt",
      "echo 'METRIC accuracy=0.90 higher'",
      "echo 'METRIC latency_ms=120 ms lower'",
    ].join("\n"), "utf8")
    await runExperimentTool.execute({ summary: "Baseline" }, context)
    await logExperimentTool.execute({ decision: "keep", asi: '{"hypothesis":"baseline capture"}' }, context)

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'optimized\\n' > app.txt",
      "echo 'METRIC accuracy=0.91 higher'",
      "echo 'METRIC latency_ms=118 ms lower'",
    ].join("\n"), "utf8")
    await runExperimentTool.execute({ summary: "Candidate 2" }, context)
    await logExperimentTool.execute({ decision: "keep", asi: '{"hypothesis":"narrower prompt","next_action_hint":"probe retrieval only"}' }, context)

    await writeFile(path.join(workspace, "benchmark.sh"), [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'optimized\\n' > app.txt",
      "echo 'METRIC accuracy=0.92 higher'",
      "echo 'METRIC latency_ms=117 ms lower'",
    ].join("\n"), "utf8")
    await runExperimentTool.execute({ summary: "Candidate 3" }, context)

    const exportResult = await controlTool.execute({ action: "export" }, context)
    expect(exportResult).toContain("autoresearch.dashboard.html")

    const html = await readText(path.join(workspace, "autoresearch.dashboard.html"))
    expect(html).toContain("Autoresearch Export")
    expect(html).toContain("Signal")
    expect(html).toContain("Segment 1")
    expect(html).toContain("1.0x noise floor")
    expect(html).toContain("Best kept")
    expect(html).toContain("probe retrieval only")
    expect(html).toContain("Finalize Preview")
    expect(html).toContain("autoresearch/run-1")
  })
})

function readCommitJsonTrailer<T>(commitMessage: string, key: string): T {
  const prefix = `${key}: `
  const line = commitMessage.split(/\r?\n/).find((item) => item.startsWith(prefix))
  if (!line) {
    throw new Error(`Missing ${key} trailer in commit message:\n${commitMessage}`)
  }
  return JSON.parse(line.slice(prefix.length)) as T
}

function toolOutput(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && "output" in result) {
    const output = (result as { output?: unknown }).output
    if (typeof output === "string") return output
  }
  return String(result)
}

async function gitObjectExists(workspace: string, objectSpec: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "cat-file", "-e", objectSpec], {
    cwd: workspace,
    stderr: "pipe",
    stdout: "pipe",
  })
  return await proc.exited === 0
}
