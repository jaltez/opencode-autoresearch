import type {
  AutoresearchPresentationModel,
  AutoresearchPresentationSignalRunSummary,
} from "../autoresearch-presentation"

export function renderDashboardHtml(model: AutoresearchPresentationModel): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>Autoresearch Dashboard</title>",
    "  <style>",
    "    :root {",
    '      color-scheme: light;',
    '      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;',
    "      --bg: #f6efe5;",
    "      --bg-strong: #fffaf2;",
    "      --ink: #201a15;",
    "      --muted: #6a6055;",
    "      --border: #d4c5b0;",
    "      --accent: #b85d35;",
    "      --accent-soft: #f1d7bf;",
    "      --signal: #2b6a63;",
    "      --signal-soft: #d7ebe8;",
    "      --shadow: 0 22px 56px rgba(54, 34, 16, 0.10);",
    "    }",
    "    * { box-sizing: border-box; }",
    "    body {",
    "      margin: 0;",
    "      color: var(--ink);",
    "      background:",
    "        radial-gradient(circle at top left, rgba(184, 93, 53, 0.18), transparent 34%),",
    "        radial-gradient(circle at top right, rgba(43, 106, 99, 0.16), transparent 28%),",
    "        linear-gradient(180deg, #fbf6ef 0%, var(--bg) 100%);",
    "    }",
    "    main { max-width: 1180px; margin: 0 auto; padding: 40px 20px 64px; }",
    "    .hero {",
    "      background: linear-gradient(135deg, rgba(255, 250, 242, 0.96), rgba(244, 230, 212, 0.92));",
    "      border: 1px solid rgba(184, 93, 53, 0.22);",
    "      border-radius: 28px;",
    "      box-shadow: var(--shadow);",
    "      padding: 28px;",
    "      margin-bottom: 20px;",
    "    }",
    "    .eyebrow { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }",
    "    h1 { font-size: clamp(32px, 5vw, 52px); line-height: 1; margin: 0 0 10px; }",
    "    .hero p { margin: 0; max-width: 72ch; color: var(--muted); font-size: 17px; line-height: 1.55; }",
    "    .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }",
    "    .chip { background: rgba(255, 250, 242, 0.92); border: 1px solid var(--border); border-radius: 999px; padding: 8px 12px; font-size: 13px; color: var(--ink); }",
    "    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }",
    "    .card { background: rgba(255, 250, 242, 0.90); border: 1px solid var(--border); border-radius: 24px; box-shadow: var(--shadow); padding: 22px; }",
    "    .card-wide { grid-column: 1 / -1; }",
    "    h2 { font-size: 19px; margin: 0 0 14px; }",
    "    .facts { display: grid; gap: 10px; }",
    "    .fact { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; border-bottom: 1px solid rgba(212, 197, 176, 0.55); padding-bottom: 8px; }",
    "    .fact:last-child { border-bottom: 0; padding-bottom: 0; }",
    "    .label { color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; }",
    "    .value { font-weight: 600; text-align: right; }",
    "    .run { border: 1px solid rgba(43, 106, 99, 0.16); border-radius: 18px; background: linear-gradient(180deg, rgba(215, 235, 232, 0.50), rgba(255, 250, 242, 0.92)); padding: 14px; margin-top: 12px; }",
    "    .run strong { display: block; font-size: 15px; margin-bottom: 4px; }",
    "    .run p, .note, .muted { margin: 6px 0 0; color: var(--muted); line-height: 1.5; }",
    "    .signal { color: var(--signal); font-weight: 700; }",
    "    .list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }",
    "    .list li { border: 1px solid rgba(212, 197, 176, 0.55); border-radius: 16px; padding: 12px; background: rgba(255, 255, 255, 0.32); }",
    "    .list strong { display: block; margin-bottom: 4px; }",
    "    details { margin-top: 14px; }",
    "    summary { cursor: pointer; color: var(--accent); font-weight: 700; }",
    "    pre { white-space: pre-wrap; overflow: auto; margin: 12px 0 0; background: var(--bg-strong); border: 1px solid rgba(212, 197, 176, 0.68); border-radius: 18px; padding: 16px; line-height: 1.5; }",
    "    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }",
    "    @media (max-width: 720px) {",
    "      main { padding: 24px 14px 40px; }",
    "      .hero, .card { padding: 18px; border-radius: 20px; }",
    "      .fact { flex-direction: column; align-items: flex-start; }",
    "      .value { text-align: left; }",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    '    <section class="hero">',
    '      <p class="eyebrow">Autoresearch Export</p>',
    `      <h1>${escapeHtml(model.name)}</h1>`,
    `      <p>${escapeHtml(model.objective ?? "Browser export generated from the current autoresearch session state.")}</p>`,
    '      <div class="chips">',
    `        ${renderChip(model.promptLabel)}`,
    `        ${renderChip(`Mode: ${model.mode}`)}`,
    `        ${renderChip(`Segment ${model.currentSegment}`)}`,
    `        ${renderChip(`${model.runCount} runs`)}`,
    `        ${renderChip(`${model.keptRuns} kept`)}`,
    `        ${renderChip(`${model.pendingRuns} pending`)}`,
    '      </div>',
    "    </section>",
    '    <section class="grid">',
    `      ${renderSessionCard(model)}`,
    `      ${renderSignalCard(model)}`,
    `      ${renderLatestRunCard(model)}`,
    `      ${renderFinalizeCard(model)}`,
    `      ${renderSummaryCard("Compaction Summary", model.summaryText)}`,
    "    </section>",
    "  </main>",
    "</body>",
    "</html>",
  ].join("\n")
}

function renderSessionCard(model: AutoresearchPresentationModel): string {
  return [
    '<section class="card">',
    "  <h2>Session</h2>",
    '  <div class="facts">',
    `    ${renderFact("Workdir", model.relativeWorkDir)}`,
    `    ${renderFact("Command", model.command ?? "not configured")}`,
    `    ${renderFact("Benchmark", model.benchmarkCommand ?? "not configured")}`,
    `    ${renderFact("Warnings", String(model.warningCount))}`,
    `    ${renderFact("Recent hook", model.recentHook ?? "none recorded")}`,
    "  </div>",
    "</section>",
  ].join("\n")
}

function renderSignalCard(model: AutoresearchPresentationModel): string {
  return [
    '<section class="card">',
    "  <h2>Signal</h2>",
    '  <div class="facts">',
    `    ${renderFact("Current segment", String(model.currentSegment))}`,
    `    ${renderFact("Segment runs", String(model.currentSegmentRunCount))}`,
    `    ${renderFact("Confidence", model.segmentConfidence)}`,
    "  </div>",
    renderSignalRun("Baseline", model.baselineRun, "Baseline not established yet."),
    renderSignalRun("Best kept", model.bestRun, "No kept winner recorded for this segment yet."),
    model.nextActionHint
      ? `  <p class="note"><span class="signal">Next:</span> ${escapeHtml(model.nextActionHint)}</p>`
      : '  <p class="muted">No next-action hint recorded yet.</p>',
    "</section>",
  ].join("\n")
}

function renderLatestRunCard(model: AutoresearchPresentationModel): string {
  if (!model.latestRun) {
    return [
      '<section class="card">',
      "  <h2>Latest Run</h2>",
      '  <p class="muted">No runs have been recorded yet.</p>',
      "</section>",
    ].join("\n")
  }

  return [
    '<section class="card">',
    "  <h2>Latest Run</h2>",
    '  <div class="facts">',
    `    ${renderFact("Run", `#${model.latestRun.iteration}`)}`,
    `    ${renderFact("Segment", String(model.latestRun.segment))}`,
    `    ${renderFact("Status", model.latestRun.status)}`,
    `    ${renderFact("Decision", model.latestRun.decision)}`,
    `    ${renderFact("Metrics", model.latestRun.metrics)}`,
    `    ${renderFact("Changed files", String(model.latestRun.changedFiles))}`,
    model.latestRun.confidence ? `    ${renderFact("Confidence", model.latestRun.confidence)}` : "",
    "  </div>",
    model.latestRun.summary ? `  <p class="note">${escapeHtml(model.latestRun.summary)}</p>` : "",
    model.latestRun.asiSummary ? `  <p class="note"><span class="signal">ASI:</span> ${escapeHtml(model.latestRun.asiSummary)}</p>` : "",
    model.latestRun.nextActionHint ? `  <p class="note"><span class="signal">Next:</span> ${escapeHtml(model.latestRun.nextActionHint)}</p>` : "",
    "</section>",
  ].filter(Boolean).join("\n")
}

function renderFinalizeCard(model: AutoresearchPresentationModel): string {
  const groups = model.finalizeGroups.length > 0
    ? [
        '  <ul class="list">',
        ...model.finalizeGroups.slice(0, 4).map((group) => [
          "    <li>",
          `      <strong>${escapeHtml(group.branchName)}</strong>`,
          `      <div>${escapeHtml(group.iterations)}</div>`,
          `      <p class="muted">${escapeHtml(group.files)}</p>`,
          group.summary ? `      <p class="note">${escapeHtml(group.summary)}</p>` : "",
          "    </li>",
        ].filter(Boolean).join("\n")),
        "  </ul>",
      ].join("\n")
    : '  <p class="muted">No review groups available yet.</p>'

  return [
    '<section class="card">',
    "  <h2>Finalize Preview</h2>",
    '  <div class="facts">',
    `    ${renderFact("Groups", String(model.finalizeGroups.length))}`,
    `    ${renderFact("Warnings", String(model.warningCount))}`,
    "  </div>",
    groups,
    "  <details>",
    "    <summary>Full finalize preview</summary>",
    `    <pre><code>${escapeHtml(model.finalizeText)}</code></pre>`,
    "  </details>",
    "</section>",
  ].join("\n")
}

function renderSummaryCard(title: string, text: string): string {
  return [
    '<section class="card card-wide">',
    `  <h2>${escapeHtml(title)}</h2>`,
    `  <pre><code>${escapeHtml(text)}</code></pre>`,
    "</section>",
  ].join("\n")
}

function renderChip(value: string): string {
  return `<span class="chip">${escapeHtml(value)}</span>`
}

function renderFact(label: string, value: string): string {
  return [
    '<div class="fact">',
    `  <span class="label">${escapeHtml(label)}</span>`,
    `  <span class="value">${escapeHtml(value)}</span>`,
    "</div>",
  ].join("\n")
}

function renderSignalRun(label: string, run: AutoresearchPresentationSignalRunSummary | undefined, emptyText: string): string {
  if (!run) {
    return `  <p class="muted">${escapeHtml(emptyText)}</p>`
  }

  return [
    '  <div class="run">',
    `    <strong>${escapeHtml(label)}: #${run.iteration} - s${run.segment} - ${run.metric}</strong>`,
    run.relativeChange ? `    <p class="note"><span class="signal">Delta:</span> ${escapeHtml(run.relativeChange)}</p>` : "",
    run.confidence ? `    <p class="note"><span class="signal">Confidence:</span> ${escapeHtml(run.confidence)}</p>` : "",
    run.summary ? `    <p class="note">${escapeHtml(run.summary)}</p>` : "",
    run.asiSummary ? `    <p class="note"><span class="signal">ASI:</span> ${escapeHtml(run.asiSummary)}</p>` : "",
    "  </div>",
  ].filter(Boolean).join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}