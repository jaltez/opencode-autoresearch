import { describe, expect, it } from "bun:test"
import { AutoresearchRuntimeStore } from "../../../src/server/runtime"

describe("runtime store", () => {
  it("queues and consumes auto resume safely", () => {
    const store = new AutoresearchRuntimeStore()
    store.activate("session-1", "/tmp/work")
    store.queueAutoResume("session-1", "run:1")

    expect(store.shouldResume("session-1", 0)).toBe(true)

    store.consumeAutoResume("session-1")
    expect(store.shouldResume("session-1", 0)).toBe(false)
    expect(store.get("session-1")?.followUpQueued).toBe(true)
  })

  it("resets pending loop when turned off", () => {
    const store = new AutoresearchRuntimeStore()
    store.activate("session-1", "/tmp/work")
    store.queueAutoResume("session-1")
    store.setMode("session-1", "off")

    expect(store.shouldResume("session-1", 0)).toBe(false)
    expect(store.get("session-1")?.autoResumePending).toBe(false)
  })
})
