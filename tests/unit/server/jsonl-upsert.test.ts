import { describe, expect, it } from "bun:test"
import { reconstructJsonlState, serializeJsonlEntry } from "../../../src/core/jsonl"

describe("jsonl run upsert", () => {
  it("replaces repeated run entries by id instead of duplicating them", () => {
    const content = [
      serializeJsonlEntry({
        at: "2026-05-10T00:00:00.000Z",
        config: { command: "bun test", createdAt: "2026-05-10T00:00:00.000Z", name: "baseline" },
        mode: "active",
        type: "session",
      }),
      serializeJsonlEntry({
        at: "2026-05-10T00:01:00.000Z",
        run: {
          command: "bun test",
          decision: "pending",
          id: "run-1",
          iteration: 1,
          metrics: [],
          startedAt: "2026-05-10T00:01:00.000Z",
          status: "completed",
        },
        type: "run",
      }),
      serializeJsonlEntry({
        at: "2026-05-10T00:02:00.000Z",
        run: {
          command: "bun test",
          decision: "keep",
          id: "run-1",
          iteration: 1,
          metrics: [],
          startedAt: "2026-05-10T00:01:00.000Z",
          status: "kept",
        },
        type: "run",
      }),
    ].join("")

    const state = reconstructJsonlState(content)

    expect(state.runs).toHaveLength(1)
    expect(state.runs[0]?.decision).toBe("keep")
    expect(state.runs[0]?.status).toBe("kept")
  })
})