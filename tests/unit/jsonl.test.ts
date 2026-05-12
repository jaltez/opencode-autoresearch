import { describe, expect, it } from "bun:test"
import { extractAutoresearchSessionName, reconstructJsonlState, serializeJsonlEntry } from "../../src/core/jsonl"

describe("jsonl", () => {
  it("reconstructs session state from mixed entries", () => {
    const content = [
      serializeJsonlEntry({
        at: "2026-05-10T00:00:00.000Z",
        config: {
          command: "bun test",
          createdAt: "2026-05-10T00:00:00.000Z",
          name: "baseline",
          primaryMetric: "accuracy",
        },
        mode: "active",
        type: "session",
      }),
      serializeJsonlEntry({
        at: "2026-05-10T00:01:00.000Z",
        run: {
          command: "bun test",
          decision: "keep",
          id: "run-1",
          iteration: 1,
          metrics: [{ higherIsBetter: true, name: "accuracy", value: 0.9 }],
          startedAt: "2026-05-10T00:01:00.000Z",
          status: "kept",
        },
        type: "run",
      }),
      serializeJsonlEntry({
        at: "2026-05-10T00:02:00.000Z",
        markdown: "Try a narrower prompt next.",
        type: "note",
      }),
    ].join("")

    const state = reconstructJsonlState(content)

    expect(state.mode).toBe("active")
    expect(state.runs).toHaveLength(1)
    expect(state.notes).toEqual(["Try a narrower prompt next."])
    expect(state.secondaryMetrics.accuracy).toEqual({
      higherIsBetter: true,
      unit: undefined,
    })
    expect(extractAutoresearchSessionName(state)).toBe("baseline")
  })
})
