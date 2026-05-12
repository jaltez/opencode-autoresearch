import { describe, expect, it } from "bun:test"
import { evaluateMetricCheckExpression, parseMetricCheckExpression } from "../../src/core/checks"

describe("metric check expressions", () => {
  it("parses metric threshold expressions", () => {
    expect(parseMetricCheckExpression("peak_flicker < 0.10")).toEqual({
      expected: 0.1,
      metricName: "peak_flicker",
      operator: "<",
    })
  })

  it("evaluates successful metric threshold expressions", () => {
    expect(evaluateMetricCheckExpression("accuracy >= 0.90", [{ name: "accuracy", value: 0.91 }])).toEqual({
      command: "accuracy >= 0.90",
      exitCode: 0,
      output: "accuracy=0.91 satisfied accuracy >= 0.90",
      passed: true,
    })
  })

  it("fails clearly when a referenced metric is missing", () => {
    expect(evaluateMetricCheckExpression("peak_flicker < 0.10", [{ name: "accuracy", value: 0.91 }])).toEqual({
      command: "peak_flicker < 0.10",
      exitCode: 1,
      output: "Metric peak_flicker was not found. Available metrics: accuracy.",
      passed: false,
    })
  })
})