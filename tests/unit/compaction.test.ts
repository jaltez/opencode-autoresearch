import { describe, expect, it } from "bun:test"
import { buildAutoresearchCompactionSummary } from "../../src/core/compaction"
import { createEmptyState } from "../../src/core/types"

describe("compaction summary", () => {
  it("renders deterministic sections", () => {
    const state = createEmptyState()
    state.mode = "active"
    state.config = {
      command: "bun test",
      createdAt: "2026-05-10T00:00:00.000Z",
      name: "baseline",
      objective: "Improve accuracy without slowing the suite.",
      primaryMetric: "accuracy",
    }
    state.runs.push({
      command: "bun test",
      decision: "keep",
      id: "run-1",
      iteration: 1,
      metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.92 }],
      startedAt: "2026-05-10T00:01:00.000Z",
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
  })
})