import type { AutoresearchMode } from "../core/types"

export interface SessionRuntime {
  agent?: string
  autoResumePending: boolean
  followUpQueued: boolean
  lastActivityAt: number
  lastAutomatedAt?: number
  mode: AutoresearchMode
  pendingReason?: string
  sessionId: string
  workDir?: string
}

export class AutoresearchRuntimeStore {
  #state = new Map<string, SessionRuntime>()

  activate(sessionId: string, workDir?: string): SessionRuntime {
    const next: SessionRuntime = {
      agent: this.#state.get(sessionId)?.agent,
      autoResumePending: false,
      followUpQueued: false,
      lastActivityAt: Date.now(),
      lastAutomatedAt: Date.now(),
      mode: "active",
      pendingReason: undefined,
      sessionId,
      workDir,
    }

    this.#state.set(sessionId, next)
    return next
  }

  clear(sessionId: string): void {
    this.#state.delete(sessionId)
  }

  get(sessionId: string): SessionRuntime | undefined {
    return this.#state.get(sessionId)
  }

  list(): SessionRuntime[] {
    return [...this.#state.values()]
  }

  setAgent(sessionId: string, agent: string | undefined): SessionRuntime | undefined {
    if (!agent) return this.#state.get(sessionId)

    const current = this.#state.get(sessionId)
    const next: SessionRuntime = {
      agent,
      autoResumePending: current?.autoResumePending ?? false,
      followUpQueued: current?.followUpQueued ?? false,
      lastActivityAt: Date.now(),
      lastAutomatedAt: current?.lastAutomatedAt,
      mode: current?.mode ?? "off",
      pendingReason: current?.pendingReason,
      sessionId,
      workDir: current?.workDir,
    }

    this.#state.set(sessionId, next)
    return next
  }

  markFollowUpQueued(sessionId: string, queued: boolean): SessionRuntime | undefined {
    const current = this.#state.get(sessionId)
    if (!current) return undefined

    const next = { ...current, followUpQueued: queued, lastActivityAt: Date.now() }
    this.#state.set(sessionId, next)
    return next
  }

  markAutomated(sessionId: string, workDir?: string): SessionRuntime {
    const current = this.#state.get(sessionId)
    const next: SessionRuntime = {
      agent: current?.agent,
      autoResumePending: current?.autoResumePending ?? false,
      followUpQueued: false,
      lastActivityAt: Date.now(),
      lastAutomatedAt: Date.now(),
      mode: current?.mode ?? "off",
      pendingReason: current?.pendingReason,
      sessionId,
      workDir: workDir ?? current?.workDir,
    }

    this.#state.set(sessionId, next)
    return next
  }

  queueAutoResume(sessionId: string, reason?: string): SessionRuntime {
    const current = this.#state.get(sessionId)
    const next: SessionRuntime = {
      agent: current?.agent,
      autoResumePending: true,
      followUpQueued: false,
      lastActivityAt: Date.now(),
      lastAutomatedAt: current?.lastAutomatedAt,
      mode: current?.mode ?? "active",
      pendingReason: reason,
      sessionId,
      workDir: current?.workDir,
    }

    this.#state.set(sessionId, next)
    return next
  }

  consumeAutoResume(sessionId: string): SessionRuntime | undefined {
    const current = this.#state.get(sessionId)
    if (!current) return undefined

    const next: SessionRuntime = {
      ...current,
      autoResumePending: false,
      followUpQueued: true,
      lastActivityAt: Date.now(),
    }

    this.#state.set(sessionId, next)
    return next
  }

  resetLoop(sessionId: string): SessionRuntime | undefined {
    const current = this.#state.get(sessionId)
    if (!current) return undefined

    const next: SessionRuntime = {
      ...current,
      autoResumePending: false,
      followUpQueued: false,
      lastActivityAt: Date.now(),
      pendingReason: undefined,
    }
    this.#state.set(sessionId, next)
    return next
  }

  setMode(sessionId: string, mode: AutoresearchMode): SessionRuntime {
    const current = this.#state.get(sessionId)
    const next: SessionRuntime = {
      agent: current?.agent,
      autoResumePending: mode === "active" ? current?.autoResumePending ?? false : false,
      followUpQueued: current?.followUpQueued ?? false,
      lastActivityAt: Date.now(),
      lastAutomatedAt: current?.lastAutomatedAt,
      mode,
      pendingReason: current?.pendingReason,
      sessionId,
      workDir: current?.workDir,
    }

    this.#state.set(sessionId, next)
    return next
  }

  shouldResume(sessionId: string, debounceMs = 4_000): boolean {
    const runtime = this.#state.get(sessionId)
    if (!runtime) return false
    if (runtime.mode !== "active") return false
    if (!runtime.autoResumePending) return false
    if (runtime.followUpQueued) return false
    return Date.now() - runtime.lastActivityAt >= debounceMs
  }

  touch(sessionId: string): SessionRuntime {
    const current = this.#state.get(sessionId)
    const next: SessionRuntime = {
      agent: current?.agent,
      autoResumePending: current?.autoResumePending ?? false,
      followUpQueued: current?.followUpQueued ?? false,
      lastActivityAt: Date.now(),
      lastAutomatedAt: current?.lastAutomatedAt,
      mode: current?.mode ?? "off",
      pendingReason: current?.pendingReason,
      sessionId,
      workDir: current?.workDir,
    }

    this.#state.set(sessionId, next)
    return next
  }
}

export const runtimeStore = new AutoresearchRuntimeStore()
