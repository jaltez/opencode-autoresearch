import { describe, expect, it } from "bun:test"
import {
  applyConfigMetricOverrides,
  buildLogExperimentSuggestion,
  describeMetricDrift,
  formatAsiOutput,
  mergeOverrideMetrics,
  parseAsi,
} from "../../../src/server/tools/experiment-helpers"

describe("experiment helpers", () => {
  it("builds a log_experiment hint using runId and the primary metric", () => {
    const hint = buildLogExperimentSuggestion({
      command: "bun test",
      decision: "pending",
      id: "run-1",
      iteration: 1,
      metrics: [{ higherIsBetter: true, name: "accuracy", unit: "%", value: 91 }],
      startedAt: "2026-05-30T00:00:00.000Z",
      status: "completed",
    }, "accuracy")

    expect(hint).toContain('runId="run-1"')
    expect(hint).toContain('metric="accuracy=91%"')
    expect(hint).toContain('decision="keep"')
  })

  it("applies config overrides only to the primary metric", () => {
    const metrics = applyConfigMetricOverrides([
      { higherIsBetter: true, name: "accuracy", value: 0.9 },
      { higherIsBetter: false, name: "latency", unit: "ms", value: 50 },
    ], {
      checks: [],
      command: "bun test",
      createdAt: "2026-05-30T00:00:00.000Z",
      metricDirection: "lower",
      metricUnit: "score",
      name: "demo",
      objective: "demo",
      primaryMetric: "accuracy",
    })

    expect(metrics[0]).toMatchObject({ higherIsBetter: false, unit: "score" })
    expect(metrics[1]).toMatchObject({ higherIsBetter: false, unit: "ms" })
  })

  it("merges ASI JSON objects and falls back to a note for plain text", () => {
    expect(parseAsi('{"why":"faster"}', { prior: true })).toEqual({ prior: true, why: "faster" })
    expect(parseAsi("investigate variance", undefined)).toEqual({ note: "investigate variance" })
    expect(formatAsiOutput({ note: "investigate", retries: 2 })).toBe("ASI: note=investigate | retries=2")
  })

  it("replaces metric overrides by name and detects schema drift", () => {
    const merged = mergeOverrideMetrics(
      [
        { higherIsBetter: true, name: "accuracy", value: 0.9 },
        { higherIsBetter: false, name: "latency", unit: "ms", value: 50 },
      ],
      "accuracy=0.95",
      ["throughput=120 req/s"],
    )

    expect(merged).toHaveLength(3)
    expect(merged[0]).toMatchObject({ higherIsBetter: true, name: "accuracy", value: 0.95 })
    expect(merged[1]).toMatchObject({ higherIsBetter: false, name: "latency", unit: "ms", value: 50 })
    expect(merged[2]).toMatchObject({ higherIsBetter: true, name: "throughput", unit: "req/s", value: 120 })
    expect(describeMetricDrift({ accuracy: { higherIsBetter: true }, latency: { higherIsBetter: false } }, merged)).toBe(
      "Metric override would change the segment schema by introducing new metric(s) throughput.",
    )
    expect(describeMetricDrift(
      { accuracy: { higherIsBetter: true }, latency: { higherIsBetter: false } },
      [{ higherIsBetter: true, name: "accuracy", value: 0.95 }, { higherIsBetter: true, name: "throughput", unit: "req/s", value: 120 }],
    )).toBe(
      "Metric override would change the segment schema by dropping previously tracked metric(s) latency and introducing new metric(s) throughput.",
    )
  })
})