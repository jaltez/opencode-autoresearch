import path from "node:path"

export function formatScriptCommand(cwd: string, scriptPath: string): string {
  const relative = path.relative(cwd, scriptPath) || path.basename(scriptPath)
  if (relative.startsWith("./") || relative.startsWith("../")) return shellQuote(relative)
  return shellQuote(`./${relative}`)
}

export async function streamToText(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ""

  let result = ""
  stream.setEncoding("utf8")
  for await (const chunk of stream) {
    result += chunk
  }
  return result
}

function shellQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'"'"'`)}'`
}