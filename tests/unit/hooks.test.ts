import { describe, expect, it } from "bun:test"
import {
  buildHookStdin,
  createHookInvocation,
  MAX_HOOK_OUTPUT_BYTES,
  parseHookStdout,
  toJsonlHookInvocation,
  trimHookText,
  type HookPayload,
} from "../../src/core/hooks"

describe("hooks", () => {
  it("truncates hook text at the reference-sized byte limit", () => {
    const text = "x".repeat(MAX_HOOK_OUTPUT_BYTES + 10)
    const trimmed = trimHookText(text)

    expect(trimmed).toContain("[truncated: hook output exceeded 8KB]")
    expect(new TextEncoder().encode(trimmed).byteLength).toBeGreaterThan(MAX_HOOK_OUTPUT_BYTES)
  })

  it("does not split utf-8 characters while truncating", () => {
    const text = `${"x".repeat(MAX_HOOK_OUTPUT_BYTES - 1)}étail`
    const trimmed = trimHookText(text)

    expect(trimmed).not.toContain("�")
    expect(trimmed).toContain("[truncated: hook output exceeded 8KB]")
  })

  it("serializes hook stdin as a single line with pi snake_case aliases", () => {
    const payload: HookPayload = {
      cwd: "/work",
      event: "before",
      projectDir: "/work",
      session: {
        currentSegment: 1,
        mode: "active",
        runCount: 2,
        baseline_metric: 0.5,
        best_metric: 0.7,
        direction: "higher",
        goal: "improve accuracy",
        metric_name: "accuracy",
        metric_unit: "%",
        run_count: 2,
      },
      sessionId: "sess",
      workDir: "/work",
    }

    const stdin = buildHookStdin(payload)
    expect(stdin.endsWith("\n")).toBe(true)
    expect(stdin.split("\n").filter(Boolean)).toHaveLength(1)
    expect(stdin).toContain('"metric_name":"accuracy"')
    expect(stdin).toContain('"direction":"higher"')
    expect(stdin).toContain('"baseline_metric":0.5')
  })

  it("parses structured hook responses and falls back to raw text", () => {
    expect(parseHookStdout("{\"decision\":\"stop\",\"message\":\"halt\"}")).toEqual({
      decision: "stop",
      message: "halt",
    })
    expect(parseHookStdout("just text")).toEqual({ message: "just text" })
    expect(parseHookStdout("")).toEqual({})
    expect(parseHookStdout("{\"decision\":\"continue\"}")).toEqual({
      decision: "continue",
      message: undefined,
    })
  })

  it("strips raw stdout/stderr when persisting a hook invocation", () => {
    const invocation = createHookInvocation({
      at: "2026-05-30T00:00:00.000Z",
      durationMs: 12,
      exitCode: 0,
      kind: "before",
      scriptPath: "/work/autoresearch.hooks/before.sh",
      status: "ok",
      stderr: "ignored",
      stdout: "{\"message\":\"hi\"}",
      stdoutBytes: 18,
    })
    const slim = toJsonlHookInvocation(invocation)
    expect(slim.message).toBe("hi")
    expect(slim.stdout).toBeUndefined()
    expect(slim.stderr).toBeUndefined()
    expect(slim.stdoutBytes).toBe(18)
    expect(slim.durationMs).toBe(12)
  })
})
