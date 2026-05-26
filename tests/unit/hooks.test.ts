import { describe, expect, it } from "bun:test"
import { MAX_HOOK_OUTPUT_BYTES, trimHookText } from "../../src/core/hooks"

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
})