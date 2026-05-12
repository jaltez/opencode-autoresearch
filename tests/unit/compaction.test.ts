import { describe, expect, it } from "bun:test"
import { buildAutoresearchCompactionSummary } from "../../src/core/compaction"
import { createEmptyState } from "../../src/core/types"

describe("compaction summary", () => {
  it("renders deterministic sections", () => {
    const state = createEmptyState()
    state.currentSegment = 2
    state.mode = "active"
    state.config = {
      benchmarkCommand: "bun test",
      command: "bun test",
      createdAt: "2026-05-10T00:00:00.000Z",
      name: "baseline",
      objective: "Improve accuracy without slowing the suite.",
      primaryMetric: "accuracy",
    }
    state.runs.push({
      command: "bun test",
      id: "run-0",
      iteration: 0,
      metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.5 }],
      segment: 1,
      startedAt: "2026-05-09T23:59:00.000Z",
      status: "kept",
      summary: "Older segment baseline.",
    })
    state.runs.push({
      command: "bun test",
      decision: "keep",
      id: "run-1",
      iteration: 1,
      metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.9 }],
      segment: 2,
      startedAt: "2026-05-10T00:01:00.000Z",
      status: "kept",
      summary: "Segment baseline.",
    })
    state.runs.push({
      asi: { next_action_hint: "Probe retrieval only." },
      command: "bun test",
      decision: "keep",
      id: "run-2",
      iteration: 2,
      metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.91 }],
      segment: 2,
      startedAt: "2026-05-10T00:02:00.000Z",
      status: "kept",
      summary: "Prompt tightened around the failing branch.",
    })
    state.runs.push({
      asi: { hypothesis: "Narrow prompt", next_action_hint: "Try smaller retrieval scope." },
      command: "bun test",
      decision: "keep",
      confidence: 2,
      id: "run-3",
      iteration: 3,
      metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.92 }],
      segment: 2,
      startedAt: "2026-05-10T00:03:00.000Z",
      status: "kept",
      summary: "Prompt tightened around the failing branch.",
    })

    const summary = buildAutoresearchCompactionSummary({
      ideasText: "Explore two-shot examples.",
      notesText: "Keep changes reviewable.",
      state,
    })

    expect(summary).toContain("# Autoresearch")
    expect(summary).toContain("## Session")
    expect(summary).toContain("## Recent Runs")
    expect(summary).toContain("## Notes")
    expect(summary).toContain("## Next Step")
    expect(summary).toContain("Improve accuracy without slowing the suite.")
    expect(summary).toContain("Current segment: 2")
    expect(summary).toContain("Best kept")
    expect(summary).toContain("2.0x noise floor")
    expect(summary).toContain("asi=[")
    expect(summary).toContain("Try smaller retrieval scope.")
  })
})