import { chmod, writeFile } from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadAutoresearchSession } from "../storage"

export interface HookScaffoldResult {
  created: string[]
  skipped: string[]
}

export const autoresearchHooksTool = tool({
  description: "Create starter before.sh and after.sh hook scripts for autoresearch with the expected JSON stdin/stdout contract.",
  args: {
    force: tool.schema.boolean().optional(),
    instructions: tool.schema.string().optional(),
    kind: tool.schema.enum(["after", "before", "both"]).optional(),
    workDir: tool.schema.string().optional(),
  },
  async execute(args, context) {
    context.metadata({ title: "Scaffold autoresearch hooks" })
    const session = await loadAutoresearchSession(context.directory, args.workDir)
    const result = await scaffoldHookFiles({
      force: args.force ?? false,
      instructions: args.instructions,
      kind: args.kind,
      workDir: session.paths.directory,
    })

    return {
      metadata: result,
      output: [
        `Hook scaffold written in ${path.relative(context.directory, session.paths.directory) || "."}.`,
        `Created: ${result.created.join(", ") || "none"}`,
        `Skipped: ${result.skipped.join(", ") || "none"}`,
      ].join("\n"),
    }
  },
})

export async function scaffoldHookFiles(input: {
  force: boolean
  instructions?: string
  kind?: "after" | "before" | "both"
  workDir: string
}): Promise<HookScaffoldResult> {
  const created: string[] = []
  const skipped: string[] = []
  const kinds = input.kind === undefined || input.kind === "both" ? ["before", "after"] as const : [input.kind]

  for (const kind of kinds) {
    const filePath = path.join(input.workDir, `${kind}.sh`)
    if (!input.force && (await Bun.file(filePath).exists())) {
      skipped.push(`${kind}.sh`)
      continue
    }

    await writeFile(filePath, hookTemplate(kind, input.instructions), "utf8")
    await chmod(filePath, 0o755)
    created.push(`${kind}.sh`)
  }

  return { created, skipped }
}

function hookTemplate(kind: "after" | "before", instructions?: string): string {
  const extraMessage = instructions ? `# Notes: ${instructions.replaceAll("\n", " ")}` : "# Notes: customize this hook for your workflow."
  const defaultMessage = kind === "before" ? "before hook ok" : "after hook ok"

  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "payload=$(cat)",
    extraMessage,
    "",
    "# Inspect the JSON payload when needed:",
    "# echo \"$payload\" >&2",
    "",
    `echo '{"message":"${defaultMessage}"}'`,
  ].join("\n")
}
