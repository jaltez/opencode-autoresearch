import { describe, expect, it } from "bun:test"
import { computeConfidence, computeRelativeChange, parseMetricLine, parseMetricLines } from "../../src/core/metrics"

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

  it("gives higher confidence to stable samples", () => {
    expect(computeConfidence([1, 1.01, 0.99, 1.02])).toBeGreaterThan(computeConfidence([1, 2.5, 0.2, 3.2]))
  })

  it("normalizes relative change by direction", () => {
    expect(computeRelativeChange(100, 120, true)).toBeCloseTo(0.2)
    expect(computeRelativeChange(100, 80, false)).toBeCloseTo(0.2)
  })
})
