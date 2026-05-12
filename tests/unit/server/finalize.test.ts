import { describe, expect, it } from "bun:test"
import { buildFinalizePlan } from "../../../src/server/finalize"

describe("finalize plan", () => {
  it("groups overlapping kept runs together and separates non-overlapping ones", () => {
    const plan = buildFinalizePlan([
      {
        changes: { modified: ["src/a.ts", "autoresearch.jsonl"], untracked: [] },
        command: "cmd",
        commit: "aaa111",
        decision: "keep",
        id: "run-1",
        iteration: 1,
        metrics: [],
        startedAt: "2026-05-12T00:00:00.000Z",
        status: "kept",
        summary: "feature a",
      },
      {
        changes: { modified: ["src/a.ts", "src/common.ts"], untracked: [] },
        command: "cmd",
        commit: "bbb222",
        decision: "keep",
        id: "run-2",
        iteration: 2,
        metrics: [],
        startedAt: "2026-05-12T00:00:00.000Z",
        status: "kept",
        summary: "feature a follow-up",
      },
      {
        changes: { modified: ["src/b.ts"], untracked: [] },
        command: "cmd",
        commit: "ccc333",
        decision: "keep",
        id: "run-3",
        iteration: 3,
        metrics: [],
        startedAt: "2026-05-12T00:00:00.000Z",
        status: "kept",
        summary: "feature b",
      },
    ])

    expect(plan.groups).toHaveLength(2)
    expect(plan.groups[0]?.commits).toEqual(["aaa111", "bbb222"])
    expect(plan.groups[0]?.files).toEqual(["src/a.ts", "src/common.ts"])
    expect(plan.groups[1]?.commits).toEqual(["ccc333"])
  })
})