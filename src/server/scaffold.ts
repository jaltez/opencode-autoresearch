import { parseMetricCheckExpression } from "../core/checks"

export function buildAutoresearchNotesTemplate(input: {
  command?: string
  name: string
  objective?: string
  primaryMetric?: string
}): string {
  return [
    `# Autoresearch: ${input.name}`,
    "",
    "## Objective",
    input.objective ?? "Describe the optimization target and the workload being measured.",
    "",
    "## Metrics",
    `- Primary: ${input.primaryMetric ?? "<fill in the primary metric>"}`,
    "- Secondary: add tradeoff metrics that should stay visible during the loop.",
    "",
    "## How to Run",
    "- Preferred entrypoint: `./autoresearch.sh`",
    input.command ? `- Default scaffold currently delegates to: \`${input.command}\`` : "- Replace `autoresearch.sh` with the real benchmark command for this session.",
    "",
    "## Files in Scope",
    "- List the files the autoresearch loop is allowed to modify.",
    "",
    "## Off Limits",
    "- List files, behaviors, or interfaces that must not change.",
    "",
    "## Constraints",
    "- Keep changes measurable, reviewable, and benchmark-driven.",
    "",
    "## What's Been Tried",
    "- Baseline not recorded yet.",
  ].join("\n")
}

export function buildAutoresearchIdeasTemplate(): string {
  return [
    "# Ideas",
    "",
    "- Capture deferred but promising ideas here so they survive compaction and reverts.",
  ].join("\n")
}

export function buildAutoresearchScriptTemplate(input: { command?: string; primaryMetric?: string }): string {
  const primaryMetric = input.primaryMetric ?? "primary_metric"
  const commandBody = input.command
    ? input.command
    : [
        'echo "Replace autoresearch.sh with the real benchmark command for this session." >&2',
        "exit 1",
      ].join("\n")

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Emit structured metrics so the autoresearch tools can parse them reliably.",
    "# Example:",
    `# METRIC ${primaryMetric}=123 lower`,
    "# METRIC secondary_metric=45 higher",
    "",
    commandBody,
  ].join("\n")
}

export function buildAutoresearchChecksScriptTemplate(checks: readonly string[] | undefined): string | undefined {
  const shellChecks = (checks ?? []).filter((check) => !parseMetricCheckExpression(check))
  if (shellChecks.length === 0) return undefined

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Keep successful runs quiet when practical and let failures speak for themselves.",
    ...shellChecks,
  ].join("\n")
}

export function buildAutoresearchConfigTemplate(input: {
  maxIterations?: number
  workDir?: string
}): string | undefined {
  const config: Record<string, number | string> = {}
  if (typeof input.maxIterations === "number") {
    config.maxIterations = input.maxIterations
  }
  if (input.workDir) {
    config.workingDir = input.workDir
  }
  if (Object.keys(config).length === 0) return undefined
  return `${JSON.stringify(config, null, 2)}\n`
}