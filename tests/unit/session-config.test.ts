import { describe, expect, it } from "bun:test"
import { isAutoresearchScriptCommand } from "../../src/core/session-config"

describe("autoresearch script command guardrail", () => {
  it("accepts canonical script invocations and harmless wrappers", () => {
    expect(isAutoresearchScriptCommand("./autoresearch.sh")).toBe(true)
    expect(isAutoresearchScriptCommand("bash ./autoresearch.sh")).toBe(true)
    expect(isAutoresearchScriptCommand("time ./autoresearch.sh")).toBe(true)
    expect(isAutoresearchScriptCommand("nice -n 10 ./autoresearch.sh")).toBe(true)
    expect(isAutoresearchScriptCommand("nohup ./autoresearch.sh")).toBe(true)
    expect(isAutoresearchScriptCommand("env FOO=bar ./autoresearch.sh")).toBe(true)
    expect(isAutoresearchScriptCommand("/tmp/session/autoresearch.sh", "/tmp/session/autoresearch.sh")).toBe(true)
  })

  it("rejects command chaining and non-canonical entrypoints", () => {
    expect(isAutoresearchScriptCommand("./benchmark.sh && ./autoresearch.sh")).toBe(false)
    expect(isAutoresearchScriptCommand("./autoresearch.sh && ./benchmark.sh")).toBe(false)
    expect(isAutoresearchScriptCommand("./autoresearch.sh; ./benchmark.sh")).toBe(false)
    expect(isAutoresearchScriptCommand("./autoresearch.sh | tee out.log")).toBe(false)
    expect(isAutoresearchScriptCommand("./benchmark.sh")).toBe(false)
  })
})