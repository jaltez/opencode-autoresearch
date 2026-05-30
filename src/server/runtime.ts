import type { AutoresearchMode } from "../core/types"

export const DEFAULT_AUTO_RESUME_CAP = 20

export interface SessionRuntime {
  agent?: string
  autoResumeCount: number
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

  #commit(
    sessionId: string,
    build: (current: SessionRuntime | undefined, now: number) => SessionRuntime,
  ): SessionRuntime {
    const current = this.#state.get(sessionId)
    const next = build(current, Date.now())
    this.#state.set(sessionId, next)
    return next
  }

  #next(
    sessionId: string,
    current: SessionRuntime | undefined,
    now: number,
    overrides: Partial<Omit<SessionRuntime, "sessionId">>,
  ): SessionRuntime {
    return {
      agent: current?.agent,
      autoResumeCount: current?.autoResumeCount ?? 0,
      autoResumePending: current?.autoResumePending ?? false,
      followUpQueued: current?.followUpQueued ?? false,
      lastActivityAt: now,
      lastAutomatedAt: current?.lastAutomatedAt,
      mode: current?.mode ?? "off",
      pendingReason: current?.pendingReason,
      sessionId,
      workDir: current?.workDir,
      ...overrides,
    }
  }

  activate(sessionId: string, workDir?: string): SessionRuntime {
    return this.#commit(sessionId, (current, now) => this.#next(sessionId, current, now, {
      autoResumeCount: 0,
      autoResumePending: false,
      followUpQueued: false,
      lastAutomatedAt: now,
      mode: "active",
      pendingReason: undefined,
      workDir,
    }))
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
    return this.#commit(sessionId, (current, now) => this.#next(sessionId, current, now, { agent }))
  }

  markFollowUpQueued(sessionId: string, queued: boolean): SessionRuntime | undefined {
    const current = this.#state.get(sessionId)
    if (!current) return undefined

    return this.#commit(sessionId, (_, now) => ({ ...current, followUpQueued: queued, lastActivityAt: now }))
  }

  markAutomated(sessionId: string, workDir?: string): SessionRuntime {
    return this.#commit(sessionId, (current, now) => this.#next(sessionId, current, now, {
      followUpQueued: false,
      lastAutomatedAt: now,
      workDir: workDir ?? current?.workDir,
    }))
  }

  queueAutoResume(sessionId: string, reason?: string, cap = DEFAULT_AUTO_RESUME_CAP): SessionRuntime {
    return this.#commit(sessionId, (current, now) => {
      const count = current?.autoResumeCount ?? 0
      if (count >= cap) {
        return this.#next(sessionId, current, now, {
          autoResumeCount: count,
          autoResumePending: false,
          followUpQueued: false,
          mode: "off",
          pendingReason: `cap:${cap}`,
        })
      }

      return this.#next(sessionId, current, now, {
        autoResumeCount: count + 1,
        autoResumePending: true,
        followUpQueued: false,
        mode: current?.mode ?? "active",
        pendingReason: reason,
      })
    })
  }

  consumeAutoResume(sessionId: string): SessionRuntime | undefined {
    const current = this.#state.get(sessionId)
    if (!current) return undefined

    return this.#commit(sessionId, (_, now) => ({
      ...current,
      autoResumePending: false,
      followUpQueued: true,
      lastActivityAt: now,
    }))
  }

  resetLoop(sessionId: string): SessionRuntime | undefined {
    const current = this.#state.get(sessionId)
    if (!current) return undefined

    return this.#commit(sessionId, (_, now) => ({
      ...current,
      autoResumeCount: 0,
      autoResumePending: false,
      followUpQueued: false,
      lastActivityAt: now,
      pendingReason: undefined,
    }))
  }

  setMode(sessionId: string, mode: AutoresearchMode): SessionRuntime {
    return this.#commit(sessionId, (current, now) => this.#next(sessionId, current, now, {
      autoResumeCount: mode === "active" ? 0 : current?.autoResumeCount ?? 0,
      autoResumePending: mode === "active" ? current?.autoResumePending ?? false : false,
      mode,
    }))
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
    return this.#commit(sessionId, (current, now) => this.#next(sessionId, current, now, {}))
  }
}

export const runtimeStore = new AutoresearchRuntimeStore()
