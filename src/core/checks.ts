import type { ExperimentCheckResult, MetricValue } from "./types"

export type MetricCheckOperator = "<" | "<=" | "==" | "!=" | ">" | ">="

export interface MetricCheckExpression {
  expected: number
  metricName: string
  operator: MetricCheckOperator
}

const METRIC_CHECK_PATTERN =
  /^\s*([A-Za-z0-9_.-]+)\s*(<=|>=|==|!=|<|>)\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*$/

export function parseMetricCheckExpression(value: string): MetricCheckExpression | undefined {
  const match = METRIC_CHECK_PATTERN.exec(value)
  if (!match) return undefined

  const [, metricName, operator, expectedValue] = match
  const expected = Number(expectedValue)
  if (!Number.isFinite(expected)) return undefined

  return {
    expected,
    metricName,
    operator: operator as MetricCheckOperator,
  }
}

export function evaluateMetricCheckExpression(
  expression: string,
  metrics: readonly MetricValue[],
): ExperimentCheckResult | undefined {
  const parsed = parseMetricCheckExpression(expression)
  if (!parsed) return undefined

  const metric = findMetric(metrics, parsed.metricName)
  if (!metric) {
    const availableMetrics = metrics.map((item) => item.name).join(", ") || "none"
    return {
      command: expression,
      exitCode: 1,
      output: `Metric ${parsed.metricName} was not found. Available metrics: ${availableMetrics}.`,
      passed: false,
    }
  }

  const passed = compareMetric(metric.value, parsed.operator, parsed.expected)
  const metricValue = `${metric.name}=${metric.value}${metric.unit ?? ""}`

  return {
    command: expression,
    exitCode: passed ? 0 : 1,
    output: `${metricValue} ${passed ? "satisfied" : "did not satisfy"} ${expression}`,
    passed,
  }
}

function compareMetric(actual: number, operator: MetricCheckOperator, expected: number): boolean {
  switch (operator) {
    case "<":
      return actual < expected
    case "<=":
      return actual <= expected
    case "==":
      return actual === expected
    case "!=":
      return actual !== expected
    case ">":
      return actual > expected
    case ">=":
      return actual >= expected
  }
}

function findMetric(metrics: readonly MetricValue[], metricName: string): MetricValue | undefined {
  const exact = metrics.find((metric) => metric.name === metricName)
  if (exact) return exact

  const normalized = metricName.toLowerCase()
  return metrics.find((metric) => metric.name.toLowerCase() === normalized)
}