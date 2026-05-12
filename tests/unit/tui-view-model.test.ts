import { describe, expect, it } from "bun:test"
import { resolveAutoresearchPaths } from "../../src/core/paths"
import type { AutoresearchWorkspaceSnapshot } from "../../src/tui/data"
import { buildAutoresearchTuiViewModel } from "../../src/tui/view-model"

describe("tui view model", () => {
  it("builds sidebar-friendly counts and finalize previews from persisted state", () => {
    const snapshot: AutoresearchWorkspaceSnapshot = {
      ideasText: "Try a narrower prompt before touching retrieval.",
      notesText: "Keep changes reviewable.",
      paths: resolveAutoresearchPaths("/tmp/project"),
      projectDir: "/tmp/project",
      state: {
        config: {
          command: "bun test",
          createdAt: "2026-05-12T00:00:00.000Z",
          name: "benchmark-loop",
          objective: "Improve accuracy without merging unrelated edits.",
          primaryMetric: "accuracy",
        },
        hooks: [
          {
            at: "2026-05-12T00:01:00.000Z",
            kind: "after",
            message: "after hook ok",
            scriptPath: "/tmp/project/after.sh",
            status: "ok",
          },
        ],
        lastUpdatedAt: "2026-05-12T00:02:00.000Z",
        mode: "active",
        notes: ["Keep the run isolated."],
        runs: [
          {
            changes: { modified: ["src/a.ts"], untracked: [] },
            command: "bun test",
            commit: "aaa111",
            decision: "keep",
            id: "run-1",
            iteration: 1,
            metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.91 }],
            startedAt: "2026-05-12T00:01:00.000Z",
            status: "kept",
            summary: "Feature A improvement.",
          },
          {
            changes: { modified: ["src/b.ts"], untracked: [] },
            command: "bun test",
            decision: "pending",
            id: "run-2",
            iteration: 2,
            metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.94 }],
            startedAt: "2026-05-12T00:02:00.000Z",
            status: "completed",
            summary: "Feature B improvement.",
          },
        ],
        secondaryMetrics: {},
      },
    }

    const model = buildAutoresearchTuiViewModel(snapshot)

    expect(model.name).toBe("benchmark-loop")
    expect(model.runCount).toBe(2)
    expect(model.keptRuns).toBe(1)
    expect(model.pendingRuns).toBe(1)
    expect(model.promptLabel).toContain("active")
    expect(model.latestRun?.iteration).toBe(2)
    expect(model.latestRun?.metrics).toContain("accuracy=0.94")
    expect(model.finalizeGroups).toHaveLength(1)
    expect(model.finalizeGroups[0]?.branchName).toContain("autoresearch/run-1")
    expect(model.recentHook).toBe("after hook ok")
    expect(model.summaryText).toContain("## Recent Runs")
  })
})