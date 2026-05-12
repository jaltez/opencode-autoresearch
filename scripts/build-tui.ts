import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["./src/tui/index.tsx"],
  external: ["@opentui/solid", "@opentui/solid/*", "solid-js", "solid-js/*"],
  outdir: "./dist/tui",
  plugins: [solidPlugin],
  target: "bun",
})

if (!result.success) {
  for (const log of result.logs) {
    const location = log.position
      ? `${log.position.file}:${log.position.line}:${log.position.column}`
      : "build"
    console.error(`${location} ${log.level}: ${log.message}`)
  }
  process.exit(1)
}