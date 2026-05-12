import { chmod, cp, mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ToolContext } from "@opencode-ai/plugin"
import { Effect } from "effect"

export interface TestToolContext extends ToolContext {
  asked: Array<{
    permission: string
    patterns: string[]
    always: string[]
    metadata: Record<string, unknown>
  }>
  metadataCalls: Array<{
    title?: string
    metadata?: Record<string, any>
  }>
}

export async function createFixtureWorkspace(name: string): Promise<string> {
  const source = path.resolve("tests/fixtures", name)
  const target = await mkdtemp(path.join(os.tmpdir(), `opencode-autoresearch-${name}-`))
  await cp(source, target, { recursive: true })

  await chmodIfPresent(path.join(target, "benchmark.sh"))
  await chmodIfPresent(path.join(target, "check.sh"))
  await chmodIfPresent(path.join(target, "before.sh"))
  await chmodIfPresent(path.join(target, "after.sh"))

  await Bun.$`git init`.cwd(target).quiet()
  await Bun.$`git config user.email test@example.com`.cwd(target).quiet()
  await Bun.$`git config user.name Test User`.cwd(target).quiet()
  await Bun.$`git add .`.cwd(target).quiet()
  await Bun.$`git commit -m "initial"`.cwd(target).quiet()

  return target
}

export function createToolContext(directory: string, sessionID = crypto.randomUUID()): TestToolContext {
  const asked: TestToolContext["asked"] = []
  const metadataCalls: TestToolContext["metadataCalls"] = []

  return {
    abort: new AbortController().signal,
    agent: "autoresearch",
    ask(input) {
      return Effect.sync(() => {
        asked.push({
          always: input.always,
          metadata: input.metadata,
          patterns: input.patterns,
          permission: input.permission,
        })
      })
    },
    asked,
    directory,
    messageID: crypto.randomUUID(),
    metadata(input) {
      metadataCalls.push(input)
    },
    metadataCalls,
    sessionID,
    worktree: directory,
  }
}

export async function readText(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8")
}

async function chmodIfPresent(filePath: string): Promise<void> {
  if (await Bun.file(filePath).exists()) {
    await chmod(filePath, 0o755)
  }
}
