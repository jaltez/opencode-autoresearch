import type { ExperimentRun, MetricValue, SecondaryMetricRegistry } from "./types"

const METRIC_PATTERN =
  /^METRIC\s+([A-Za-z0-9_.µ-]+)\s*(?:=|:)?\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(?:\s+([%A-Za-zµ][\w/%µ.-]*))?(?:\s+(higher|lower))?\s*$/iu

const LOWER_IS_BETTER = ["duration", "error", "latency", "loss", "memory", "time"]
const HIGHER_IS_BETTER = ["accuracy", "f1", "ops", "precision", "qps", "recall", "rps", "score", "success", "throughput"]
const DENIED_METRIC_NAMES = new Set(["__proto__", "constructor", "prototype"])

export function parseMetricLine(line: string): MetricValue | undefined {
  const trimmed = line.trim()
  const match = METRIC_PATTERN.exec(trimmed)
  if (!match) return undefined

  const [, rawName, rawValue, rawUnit, rawDirection] = match
  if (DENIED_METRIC_NAMES.has(rawName)) return undefined

  const value = Number(rawValue)
  if (!Number.isFinite(value)) return undefined

  const normalizedUnit = rawUnit?.toLowerCase()
  const direction =
    rawDirection?.toLowerCase() ?? (normalizedUnit === "higher" || normalizedUnit === "lower" ? normalizedUnit : undefined)
  const unit = direction === rawUnit?.toLowerCase() ? undefined : rawUnit

  return {
    higherIsBetter:
      direction === "higher"
        ? true
        : direction === "lower"
          ? false
          : inferHigherIsBetter(rawName),
    name: rawName,
    unit: inferMetricUnit(rawName, unit),
    value,
  }
}

export function parseMetricLines(output: string): MetricValue[] {
  const metrics = new Map<string, MetricValue>()
  for (const line of output.split(/\r?\n/u)) {
    const metric = parseMetricLine(line)
    if (!metric) continue
    metrics.set(metric.name, metric)
  }

  return [...metrics.values()]
}

export function inferMetricUnit(name: string, explicitUnit?: string): string | undefined {
  if (explicitUnit) return explicitUnit

  const normalized = name.toLowerCase()
  if (normalized.endsWith("µs") || normalized.endsWith("_us") || normalized.endsWith("_microseconds")) return "µs"
  if (normalized.endsWith("_ms") || normalized.includes("millisecond")) return "ms"
  if (normalized.endsWith("_s") || normalized.includes("second")) return "s"
  if (normalized.endsWith("_pct") || normalized.includes("percent")) return "%"
  if (normalized.endsWith("_bytes") || normalized.includes("memory")) return "bytes"
  return undefined
}

export function inferHigherIsBetter(name: string): boolean {
  const normalized = name.toLowerCase()
  if (normalized.endsWith("µs") || normalized.endsWith("_us") || normalized.endsWith("_ms") || normalized.endsWith("_s")) return false
  if (LOWER_IS_BETTER.some((token) => normalized.includes(token))) return false
  if (HIGHER_IS_BETTER.some((token) => normalized.includes(token))) return true
  return true
}

export function registerSecondaryMetrics(
  registry: SecondaryMetricRegistry,
  metrics: readonly MetricValue[],
): SecondaryMetricRegistry {
  const next = { ...registry }

  for (const metric of metrics) {
    next[metric.name] = {
      higherIsBetter: metric.higherIsBetter ?? inferHigherIsBetter(metric.name),
      unit: metric.unit,
    }
  }

  return next
}

export function findPrimaryMetric(metrics: readonly MetricValue[], primaryMetricName?: string): MetricValue | undefined {
  if (metrics.length === 0) return undefined
  if (!primaryMetricName) return metrics[0]

  const exact = metrics.find((metric) => metric.name === primaryMetricName)
  if (exact) return exact

  const normalized = primaryMetricName.toLowerCase()
  return metrics.find((metric) => metric.name.toLowerCase() === normalized) ?? metrics[0]
}

export function isBetterMetricValue(candidate: MetricValue, incumbent: MetricValue): boolean {
  const higherIsBetter = candidate.higherIsBetter ?? incumbent.higherIsBetter ?? inferHigherIsBetter(candidate.name)
  return higherIsBetter ? candidate.value > incumbent.value : candidate.value < incumbent.value
}

export function computeSegmentConfidence(
  runs: readonly ExperimentRun[],
  primaryMetricName?: string,
): number | null {
  const series = runs
    .map((run) => ({
      metric: findPrimaryMetric(run.metrics, primaryMetricName),
      run,
    }))
    .filter((entry): entry is { metric: MetricValue; run: ExperimentRun } => Boolean(entry.metric && Number.isFinite(entry.metric.value)))

  if (series.length < 3) return null

  const baseline = series[0].metric
  let bestKept: MetricValue | undefined
  for (const entry of series) {
    if (entry.run.decision !== "keep" && entry.run.status !== "kept") continue
    if (!bestKept || isBetterMetricValue(entry.metric, bestKept)) {
      bestKept = entry.metric
    }
  }

  if (!bestKept || bestKept.value === baseline.value) return null

  const values = series.map((entry) => entry.metric.value)
  const mad = computeMedianAbsoluteDeviation(values)
  if (mad === 0) return null

  return Math.abs(bestKept.value - baseline.value) / mad
}

export function computeConfidence(values: readonly number[]): number {
  const samples = values.filter((value) => Number.isFinite(value))
  if (samples.length === 0) return 0
  if (samples.length === 1) return 0.2

  const median = computeMedian(samples)
  const spread = computeStandardDeviation(samples)
  const absoluteDeviations = samples.map((value) => Math.abs(value - median))
  const mad = computeMedian(absoluteDeviations)
  const last = samples.at(-1) ?? median
  const robustScale = mad === 0 ? 0 : 1.4826 * mad
  const zScore = robustScale === 0 ? 0 : Math.abs(last - median) / robustScale
  const magnitude = Math.max(Math.abs(median), ...samples.map((value) => Math.abs(value)), 1)
  const variability = spread / magnitude
  const stability = 1 / (1 + variability * 6)
  const recencyAlignment = robustScale === 0 ? 1 : 1 / (1 + zScore)
  const sampleFactor = Math.min(1, samples.length / 6)

  return clamp(0.1 + sampleFactor * 0.35 + stability * 0.35 + recencyAlignment * 0.2, 0, 1)
}

export function computeRelativeChange(previous: number, current: number, higherIsBetter: boolean): number {
  if (previous === 0) return current === 0 ? 0 : higherIsBetter ? 1 : -1
  const delta = (current - previous) / Math.abs(previous)
  return higherIsBetter ? delta : -delta
}

function computeMedian(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[midpoint - 1] + sorted[midpoint]) / 2
  return sorted[midpoint]
}

function computeMedianAbsoluteDeviation(values: readonly number[]): number {
  const median = computeMedian(values)
  return computeMedian(values.map((value) => Math.abs(value - median)))
}

function computeStandardDeviation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
