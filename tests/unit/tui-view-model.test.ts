import { describe, expect, it } from "bun:test"
import { resolveAutoresearchPaths } from "../../src/core/paths"
import type { AutoresearchWorkspaceSnapshot } from "../../src/tui/data"
import { buildAutoresearchTuiViewModel } from "../../src/tui/view-model"

describe("tui view model", () => {
  it("builds sidebar-friendly counts, signal summaries, and finalize previews from persisted state", () => {
    const snapshot: AutoresearchWorkspaceSnapshot = {
      ideasText: "Try a narrower prompt before touching retrieval.",
      notesText: "Keep changes reviewable.",
      paths: resolveAutoresearchPaths("/tmp/project"),
      projectDir: "/tmp/project",
      state: {
        currentSegment: 2,
        config: {
          benchmarkCommand: "bun test",
          command: "./autoresearch.sh",
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
            changes: { modified: ["src/older.ts"], untracked: [] },
            command: "./autoresearch.sh",
            decision: "discard",
            id: "run-0",
            iteration: 0,
            metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.87 }],
            segment: 1,
            startedAt: "2026-05-11T23:59:00.000Z",
            status: "discarded",
            summary: "Older segment improvement.",
          },
          {
            changes: { modified: ["src/a.ts"], untracked: [] },
            command: "./autoresearch.sh",
            commit: "aaa111",
            decision: "keep",
            id: "run-1",
            iteration: 1,
            metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.9 }],
            segment: 2,
            startedAt: "2026-05-12T00:01:00.000Z",
            status: "kept",
            summary: "Current segment baseline.",
          },
          {
            changes: { modified: ["src/a.ts", "src/b.ts"], untracked: [] },
            asi: {
              hypothesis: "Prompt narrowed around the failing branch.",
              next_action_hint: "Probe retrieval before touching prompts again.",
            },
            command: "./autoresearch.sh",
            confidence: 1,
            decision: "keep",
            id: "run-2",
            iteration: 2,
            metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.91 }],
            segment: 2,
            startedAt: "2026-05-12T00:02:00.000Z",
            status: "kept",
            summary: "Feature A improvement.",
          },
          {
            changes: { modified: ["src/c.ts"], untracked: [] },
            command: "./autoresearch.sh",
            decision: "pending",
            id: "run-3",
            iteration: 3,
            metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.92 }],
            segment: 2,
            startedAt: "2026-05-12T00:03:00.000Z",
            status: "completed",
            summary: "Feature B improvement.",
          },
        ],
        secondaryMetrics: {},
      },
    }

    const model = buildAutoresearchTuiViewModel(snapshot)

    expect(model.name).toBe("benchmark-loop")
    expect(model.runCount).toBe(4)
  expect(model.keptRuns).toBe(2)
    expect(model.pendingRuns).toBe(1)
    expect(model.promptLabel).toContain("active")
    expect(model.promptLabel).toContain("s2")
    expect(model.currentSegment).toBe(2)
    expect(model.currentSegmentRunCount).toBe(3)
    expect(model.segmentConfidence).toContain("1.0x noise floor")
    expect(model.baselineRun?.iteration).toBe(1)
    expect(model.bestRun?.iteration).toBe(2)
    expect(model.bestRun?.relativeChange).toContain("+1.1%")
    expect(model.bestRun?.asiSummary).toContain("hypothesis=Prompt narrowed around the failing branch.")
    expect(model.nextActionHint).toBe("Probe retrieval before touching prompts again.")
    expect(model.latestRun?.iteration).toBe(3)
    expect(model.latestRun?.segment).toBe(2)
    expect(model.latestRun?.metrics).toContain("accuracy=0.92")
    expect(model.finalizeGroups).toHaveLength(1)
    expect(model.finalizeGroups[0]?.branchName).toContain("autoresearch/run-1")
    expect(model.recentHook).toBe("after hook ok")
    expect(model.summaryText).toContain("## Recent Runs")
  })

  it("surfaces durability recovery signals in the view model", () => {
    const snapshot: AutoresearchWorkspaceSnapshot = {
      durability: {
        backupCount: 2,
        degraded: true,
        issues: [
          {
            code: "missing_jsonl",
            message: "autoresearch.jsonl is missing, so the source-of-truth session history cannot be trusted.",
            recovery: "Use autoresearch action=restore before resuming the loop.",
            severity: "error",
          },
        ],
        requiresRecovery: true,
      },
      paths: resolveAutoresearchPaths("/tmp/project"),
      projectDir: "/tmp/project",
      state: {
        hooks: [],
        mode: "paused",
        notes: [],
        runs: [],
        secondaryMetrics: {},
      },
    }

    const model = buildAutoresearchTuiViewModel(snapshot)

    expect(model.durabilityRecoveryRequired).toBe(true)
    expect(model.durabilityBackupCount).toBe(2)
    expect(model.durabilityIssueCount).toBe(1)
    expect(model.promptLabel).toContain("repair")
  })
})