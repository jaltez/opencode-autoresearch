import { describe, expect, it } from "bun:test"
import { computeConfidence, computeRelativeChange, computeSegmentConfidence, parseMetricLine, parseMetricLines } from "../../src/core/metrics"

describe("metrics", () => {
  it("parses METRIC lines with units and direction", () => {
    expect(parseMetricLine("METRIC latency_ms=123 ms lower")).toEqual({
      higherIsBetter: false,
      name: "latency_ms",
      unit: "ms",
      value: 123,
    })
  })

  it("extracts all metrics from command output", () => {
    expect(parseMetricLines("ok\nMETRIC accuracy=0.91 higher\nMETRIC loss: 0.12 lower")).toEqual([
      {
        higherIsBetter: true,
        name: "accuracy",
        unit: undefined,
        value: 0.91,
      },
      {
        higherIsBetter: false,
        name: "loss",
        unit: undefined,
        value: 0.12,
      },
    ])
  })

  it("supports reference-compatible metric names and keeps the last duplicate value", () => {
    expect(parseMetricLines([
      "METRIC total_µs=15200",
      "METRIC compile.ms=4200",
      "METRIC total_µs=14900",
    ].join("\n"))).toEqual([
      {
        higherIsBetter: false,
        name: "total_µs",
        unit: "µs",
        value: 14900,
      },
      {
        higherIsBetter: true,
        name: "compile.ms",
        unit: undefined,
        value: 4200,
      },
    ])
  })

  it("rejects unsafe or non-finite metric lines", () => {
    expect(parseMetricLines([
      "METRIC __proto__=1",
      "METRIC constructor=2",
      "METRIC prototype=3",
      "METRIC safe=Infinity",
      "METRIC also_safe=NaN",
      "METRIC hex=0x10",
      "METRIC valid=4",
    ].join("\n"))).toEqual([
      {
        higherIsBetter: true,
        name: "valid",
        unit: undefined,
        value: 4,
      },
    ])
  })

  it("continues to support opencode metric extensions", () => {
    expect(parseMetricLine("METRIC loss: 0.12 lower")).toEqual({
      higherIsBetter: false,
      name: "loss",
      unit: undefined,
      value: 0.12,
    })
    expect(parseMetricLine("METRIC latency-ms=123 ms lower")).toEqual({
      higherIsBetter: false,
      name: "latency-ms",
      unit: "ms",
      value: 123,
    })
  })

  it("gives higher confidence to stable samples", () => {
    expect(computeConfidence([1, 1.01, 0.99, 1.02])).toBeGreaterThan(computeConfidence([1, 2.5, 0.2, 3.2]))
  })

  it("computes stronger segment confidence when the best kept run stands above noise", () => {
    const stable = [0.9, 0.91, 0.92].map((value, index) => ({
      command: "./autoresearch.sh",
      decision: "keep" as const,
      id: `stable-${index}`,
      iteration: index + 1,
      metrics: [{ higherIsBetter: true, name: "accuracy", value }],
      startedAt: `2026-05-10T00:0${index}:00.000Z`,
      status: "kept" as const,
    }))
    const noisy = [0.9, 1.0, 0.8].map((value, index) => ({
      command: "./autoresearch.sh",
      decision: "keep" as const,
      id: `noisy-${index}`,
      iteration: index + 1,
      metrics: [{ higherIsBetter: true, name: "accuracy", value }],
      startedAt: `2026-05-10T00:1${index}:00.000Z`,
      status: "kept" as const,
    }))

    expect(computeSegmentConfidence(stable, "accuracy")).toBeGreaterThan(computeSegmentConfidence(noisy, "accuracy") ?? 0)
    expect(computeSegmentConfidence(stable.slice(0, 2), "accuracy")).toBeNull()
  })

  it("normalizes relative change by direction", () => {
    expect(computeRelativeChange(100, 120, true)).toBeCloseTo(0.2)
    expect(computeRelativeChange(100, 80, false)).toBeCloseTo(0.2)
  })
})
