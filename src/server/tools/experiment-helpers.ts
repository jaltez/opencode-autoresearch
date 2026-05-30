import type { ExperimentConfig, ExperimentRun, MetricValue, SecondaryMetricRegistry } from "../../core/types"
import { parseMetricLine } from "../../core/metrics"

export function buildLogExperimentSuggestion(run: ExperimentRun, primaryMetric: string | undefined): string {
  const primary = primaryMetric
    ? run.metrics.find((metric) => metric.name === primaryMetric)
    : run.metrics[0]
  const metricSuffix = primary ? ` metric=\"${primary.name}=${primary.value}${primary.unit ?? ""}\"` : ""
  const decisionHint = run.status === "checks_failed"
    ? "discard"
    : run.status === "crashed" || run.status === "failed"
      ? "discard"
      : "keep"
  return `Next: call log_experiment with runId=\"${run.id}\" decision=\"${decisionHint}\"${metricSuffix} once you have judged the change.`
}

export function applyConfigMetricOverrides(
  metrics: readonly MetricValue[],
  config: ExperimentConfig | undefined,
): MetricValue[] {
  if (!config?.primaryMetric || (!config.metricUnit && !config.metricDirection)) {
    return [...metrics]
  }

  return metrics.map((metric) => {
    if (metric.name !== config.primaryMetric) return metric
    return {
      ...metric,
      higherIsBetter:
        config.metricDirection === "higher"
          ? true
          : config.metricDirection === "lower"
            ? false
            : metric.higherIsBetter,
      unit: config.metricUnit ?? metric.unit,
    }
  })
}

export function formatConfidenceOutput(confidence: number | null | undefined): string | undefined {
  if (confidence == null) return undefined
  if (confidence >= 2) return `Confidence: ${confidence.toFixed(1)}x noise floor — improvement is likely real.`
  if (confidence >= 1) return `Confidence: ${confidence.toFixed(1)}x noise floor — improvement is above noise but still marginal.`
  return `Confidence: ${confidence.toFixed(1)}x noise floor — this result is still within noise; rerun if you need to confirm it.`
}

export function formatAsiOutput(asi: Record<string, unknown> | undefined): string | undefined {
  if (!asi || Object.keys(asi).length === 0) return undefined

  const parts = Object.entries(asi)
    .map(([key, value]) => `${key}=${stringifyAsiValue(value)}`)
  return `ASI: ${parts.join(" | ")}`
}

export function parseAsi(value: string | undefined, existing: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return existing

  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        ...(existing ?? {}),
        ...(parsed as Record<string, unknown>),
      }
    }
  } catch {
  }

  return {
    ...(existing ?? {}),
    note: value.trim(),
  }
}

export function mergeOverrideMetrics(
  base: readonly MetricValue[],
  single: string | undefined,
  many: readonly string[] | undefined,
): MetricValue[] {
  const overrides: MetricValue[] = []
  const candidates = [single, ...(many ?? [])].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  for (const candidate of candidates) {
    const parsed = parseMetricLine(candidate.startsWith("METRIC ") ? candidate : `METRIC ${candidate}`)
    if (parsed) overrides.push(parsed)
  }

  if (overrides.length === 0) return [...base]

  const map = new Map<string, MetricValue>()
  for (const metric of base) map.set(metric.name, metric)
  for (const override of overrides) map.set(override.name, override)
  return [...map.values()]
}

export function describeMetricDrift(
  registry: SecondaryMetricRegistry,
  merged: readonly MetricValue[],
): string | undefined {
  const expected = new Set(Object.keys(registry))
  if (expected.size === 0) return undefined

  const incoming = new Set(merged.map((metric) => metric.name))
  const removed = [...expected].filter((name) => !incoming.has(name))
  const added = [...incoming].filter((name) => !expected.has(name))

  if (removed.length === 0 && added.length === 0) return undefined

  const parts: string[] = []
  if (removed.length > 0) parts.push(`dropping previously tracked metric(s) ${removed.join(", ")}`)
  if (added.length > 0) parts.push(`introducing new metric(s) ${added.join(", ")}`)
  return `Metric override would change the segment schema by ${parts.join(" and ")}.`
}

function stringifyAsiValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}