import { describe, expect, it } from "bun:test"
import { AutoresearchRuntimeStore, DEFAULT_AUTO_RESUME_CAP } from "../../../src/server/runtime"

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

  it("caps auto-resume queueing per session and surfaces the cap reason", () => {
    const store = new AutoresearchRuntimeStore()
    store.activate("session-1", "/tmp/work")

    for (let i = 0; i < DEFAULT_AUTO_RESUME_CAP; i += 1) {
      store.queueAutoResume("session-1", `run:${i}`, 3)
      store.consumeAutoResume("session-1")
      if (i === 2) break
    }

    const beyond = store.queueAutoResume("session-1", "run:overflow", 3)
    expect(beyond.mode).toBe("off")
    expect(beyond.autoResumePending).toBe(false)
    expect(beyond.pendingReason).toBe("cap:3")
    expect(store.shouldResume("session-1", 0)).toBe(false)
  })

  it("resets the cap counter when the loop is reset or reactivated", () => {
    const store = new AutoresearchRuntimeStore()
    store.activate("session-1", "/tmp/work")
    store.queueAutoResume("session-1", "run:1", 2)
    store.queueAutoResume("session-1", "run:2", 2)
    const capped = store.queueAutoResume("session-1", "run:3", 2)
    expect(capped.mode).toBe("off")

    store.activate("session-1", "/tmp/work")
    const requeued = store.queueAutoResume("session-1", "run:4", 2)
    expect(requeued.mode).toBe("active")
    expect(requeued.autoResumeCount).toBe(1)
  })
})
