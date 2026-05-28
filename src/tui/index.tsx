import "@opentui/solid/runtime-plugin-support"
import path from "node:path"
import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { loadAutoresearchWorkspaceSnapshot } from "./data"
import { buildAutoresearchTuiViewModel, type AutoresearchTuiViewModel } from "./view-model"

const SIDEBAR_POLL_MS = 2_000
const DASHBOARD_ROUTE = "autoresearch-dashboard"

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode.autoresearch",
  tui: async (api) => {
    const unregisterRoutes = api.route.register([
      {
        name: DASHBOARD_ROUTE,
        render: () => <AutoresearchDashboard projectDir={api.state.path.directory} />,
      },
    ])

    const unregisterCommands = api.command?.register(() => {
      const sessionID = getCurrentSessionID(api)
      return [
        createPaletteItem({
          action: "status",
          description: "Ask the current session for a deterministic autoresearch status summary.",
          sessionID,
          title: "Autoresearch: Status",
        }, api),
        createPaletteItem({
          action: "backup",
          description: "Create a durable backup of the current autoresearch session artifacts.",
          sessionID,
          title: "Autoresearch: Backup Session",
        }, api),
        createPaletteItem({
          description: "Open the OpenCode Autoresearch dashboard for the current workspace.",
          enabled: Boolean(api.state.path.directory),
          onSelect: () => {
            api.route.navigate(DASHBOARD_ROUTE, sessionID ? { sessionID } : undefined)
          },
          title: "Autoresearch: Open Dashboard",
          value: "autoresearch.dashboard",
        }, api),
        createPaletteItem({
          action: "export",
          description: "Export the current autoresearch dashboard from the active session.",
          sessionID,
          title: "Autoresearch: Export Dashboard",
        }, api),
        createPaletteItem({
          action: "pause",
          description: "Pause automatic autoresearch continuation for the active session.",
          sessionID,
          title: "Autoresearch: Pause",
        }, api),
        createPaletteItem({
          action: "resume",
          description: "Resume automatic autoresearch continuation for the active session.",
          sessionID,
          title: "Autoresearch: Resume",
        }, api),
        createPaletteItem({
          action: "restore",
          description: "Restore the latest autoresearch backup for the active session.",
          sessionID,
          title: "Autoresearch: Restore Latest Backup",
        }, api),
        createPaletteItem({
          commandName: "autoresearch-finalize",
          description: "Prepare a finalize plan for the kept autoresearch runs.",
          sessionID,
          title: "Autoresearch: Finalize Plan",
          value: "autoresearch.finalize",
        }, api),
      ]
    })

    api.slots.register({
      slots: {
        session_prompt_right: (_ctx, props) => (
          <AutoresearchPromptStatus
            projectDir={api.state.path.directory}
            sessionID={props.session_id}
          />
        ),
        sidebar_content: () => <AutoresearchSidebar projectDir={api.state.path.directory} />,
        sidebar_footer: () => <AutoresearchSidebarFooter />,
      },
    })

    api.lifecycle.onDispose(unregisterRoutes)
    if (unregisterCommands) {
      api.lifecycle.onDispose(unregisterCommands)
    }
  },
}

export default plugin

function createPaletteItem(
  input: {
    action?: "backup" | "export" | "pause" | "restore" | "resume" | "status"
    commandName?: "autoresearch-finalize"
    description: string
    enabled?: boolean
    onSelect?: () => void | Promise<void>
    sessionID?: string
    title: string
    value?: string
  },
  api: Parameters<NonNullable<TuiPluginModule["tui"]>>[0],
) {
  return {
    category: "Autoresearch",
    description: input.description,
    enabled: input.enabled ?? Boolean(input.sessionID ?? input.onSelect),
    hidden: false,
    onSelect: async () => {
      if (input.onSelect) {
        await input.onSelect()
        return
      }

      if (!input.sessionID) {
        api.ui.toast({
          message: "Open a session first to use autoresearch actions.",
          title: "Autoresearch",
          variant: "warning",
        })
        return
      }

      try {
        if (input.commandName) {
          await api.client.session.command({
            arguments: "",
            command: input.commandName,
            directory: api.state.path.directory,
            sessionID: input.sessionID,
          })
        } else {
          await api.client.session.command({
            arguments: input.action,
            command: "autoresearch",
            directory: api.state.path.directory,
            sessionID: input.sessionID,
          })
        }
        api.ui.toast({
          message: `Queued ${input.commandName ?? `autoresearch ${input.action}`} in the active session.`,
          title: "Autoresearch",
          variant: "success",
        })
      } catch (error) {
        api.ui.toast({
          message: error instanceof Error ? error.message : "Failed to queue autoresearch action.",
          title: "Autoresearch",
          variant: "error",
        })
      }
    },
    title: input.title,
    value: input.value ?? `autoresearch.${input.action}`,
  }
}

function AutoresearchPromptStatus(props: { projectDir: string; sessionID: string }) {
  const model = useAutoresearchModel(() => props.projectDir)
  return (
    <box paddingLeft={1}>
      <text fg={model()?.durabilityRecoveryRequired ? "#e28b6d" : modeColor(model()?.mode)}>
        {model()?.promptLabel ?? `AR · ${path.basename(props.projectDir)}`}
      </text>
    </box>
  )
}

function AutoresearchSidebar(props: { projectDir: string }) {
  const model = useAutoresearchModel(() => props.projectDir)

  return (
    <scrollbox height="100%" width="100%" paddingRight={1}>
      <box flexDirection="column" gap={1} paddingBottom={1}>
        <Show when={model()} fallback={<SidebarEmptyState projectDir={props.projectDir} />}>
          <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Autoresearch">
            <text fg="#f3ede2">{model()?.name}</text>
            <Show when={model()?.objective}>
              <text fg="#d5c8a2" wrapMode="word">{model()?.objective}</text>
            </Show>
            <text fg="#8dcf9f">Mode: {model()?.mode}</text>
            <text fg="#8dcf9f">Segment: {model()?.currentSegment}</text>
            <text fg="#aab5c4">Workdir: {model()?.relativeWorkDir}</text>
            <Show when={model()?.command}>
              <text fg="#aab5c4" wrapMode="word">Command: {model()?.command}</text>
            </Show>
            <Show when={model()?.benchmarkCommand}>
              <text fg="#aab5c4" wrapMode="word">Benchmark: {model()?.benchmarkCommand}</text>
            </Show>
          </box>

          <Show when={model()}>
            {(resolved: () => AutoresearchTuiViewModel) => <AutoresearchDurabilityCard model={resolved()} />}
          </Show>

          <Show when={model()}>
            {(resolved: () => AutoresearchTuiViewModel) => <AutoresearchSignalCard model={resolved()} />}
          </Show>

          <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Runs">
            <text fg="#f3ede2">
              Total {model()?.runCount ?? 0} · kept {model()?.keptRuns ?? 0} · pending {model()?.pendingRuns ?? 0}
            </text>
            <Show when={model()?.latestRun} fallback={<text fg="#aab5c4">No runs recorded yet.</text>}>
              <text fg="#d6dde6">
                Latest #{model()?.latestRun?.iteration} · s{model()?.latestRun?.segment} · {model()?.latestRun?.status} · {model()?.latestRun?.decision}
              </text>
              <text fg="#d5c8a2" wrapMode="word">Metrics: {model()?.latestRun?.metrics}</text>
              <Show when={model()?.latestRun?.changedFiles !== undefined}>
                <text fg="#aab5c4">Changed files: {model()?.latestRun?.changedFiles}</text>
              </Show>
              <Show when={model()?.latestRun?.confidence}>
                <text fg="#8dcf9f">Confidence: {model()?.latestRun?.confidence}</text>
              </Show>
              <Show when={model()?.latestRun?.summary}>
                <text fg="#f3ede2" wrapMode="word">{model()?.latestRun?.summary}</text>
              </Show>
              <Show when={model()?.latestRun?.asiSummary}>
                <text fg="#d5c8a2" wrapMode="word">ASI: {model()?.latestRun?.asiSummary}</text>
              </Show>
              <Show when={model()?.latestRun?.nextActionHint}>
                <text fg="#d5c8a2" wrapMode="word">Next: {model()?.latestRun?.nextActionHint}</text>
              </Show>
            </Show>
          </box>

          <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Finalize">
            <text fg="#f3ede2">Groups: {model()?.finalizeGroups.length ?? 0} · warnings: {model()?.warningCount ?? 0}</text>
            <Show when={(model()?.finalizeGroups.length ?? 0) > 0} fallback={<text fg="#aab5c4">No review groups available yet.</text>}>
              <For each={model()?.finalizeGroups.slice(0, 3) ?? []}>
                {(group) => (
                  <box flexDirection="column" gap={0}>
                    <text fg="#8dcf9f">{group.branchName}</text>
                    <text fg="#d6dde6">{group.iterations}</text>
                    <text fg="#aab5c4" wrapMode="word">{group.files}</text>
                    <Show when={group.summary}>
                      <text fg="#d5c8a2" wrapMode="word">{group.summary}</text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
          </box>

          <Show when={model()?.recentHook}>
            <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Hook">
              <text fg="#aab5c4" wrapMode="word">{model()?.recentHook}</text>
            </box>
          </Show>
        </Show>
      </box>
    </scrollbox>
  )
}

function AutoresearchSidebarFooter() {
  return (
    <box paddingTop={1}>
      <text fg="#8a8f98">Palette: Open Dashboard · Status · Finalize Plan</text>
    </box>
  )
}

function AutoresearchDashboard(props: { projectDir: string }) {
  const model = useAutoresearchModel(() => props.projectDir)

  return (
    <scrollbox height="100%" width="100%">
      <box flexDirection="column" gap={1} padding={1}>
        <Show when={model()} fallback={<SidebarEmptyState projectDir={props.projectDir} />}>
          <box border borderColor="#c78c3a" flexDirection="column" gap={1} padding={1} title="Autoresearch Dashboard">
            <text fg="#f3ede2">{model()?.promptLabel}</text>
            <Show when={model()?.objective}>
              <text fg="#d5c8a2" wrapMode="word">{model()?.objective}</text>
            </Show>
          </box>

          <Show when={model()}>
            {(resolved: () => AutoresearchTuiViewModel) => <AutoresearchDurabilityCard model={resolved()} />}
          </Show>

          <Show when={model()}>
            {(resolved: () => AutoresearchTuiViewModel) => <AutoresearchSignalCard model={resolved()} />}
          </Show>

          <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Summary">
            <text fg="#d6dde6" wrapMode="word">{model()?.summaryText ?? ""}</text>
          </box>

          <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Finalize Preview">
            <text fg="#d6dde6" wrapMode="word">{model()?.finalizeText ?? ""}</text>
          </box>
        </Show>
      </box>
    </scrollbox>
  )
}

function SidebarEmptyState(props: { projectDir: string }) {
  return (
    <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Autoresearch">
      <text fg="#f3ede2">No persisted autoresearch state found.</text>
      <text fg="#aab5c4" wrapMode="word">
        Initialize a session in {path.basename(props.projectDir)} with /autoresearch-create or init_experiment.
      </text>
    </box>
  )
}

function AutoresearchSignalCard(props: { model: AutoresearchTuiViewModel }) {
  return (
    <box border borderColor="#3d3d3d" flexDirection="column" gap={1} padding={1} title="Signal">
      <text fg="#f3ede2">
        Segment {props.model.currentSegment} · {props.model.currentSegmentRunCount} run{props.model.currentSegmentRunCount === 1 ? "" : "s"}
      </text>
      <text fg="#8dcf9f">Confidence: {props.model.segmentConfidence}</text>
      <Show when={props.model.baselineRun} fallback={<text fg="#aab5c4">Baseline: not established yet.</text>}>
        {(run: () => NonNullable<AutoresearchTuiViewModel["baselineRun"]>) => <AutoresearchSignalRun label="Baseline" run={run()} />}
      </Show>
      <Show when={props.model.bestRun} fallback={<text fg="#aab5c4">Best kept: none yet.</text>}>
        {(run: () => NonNullable<AutoresearchTuiViewModel["baselineRun"]>) => <AutoresearchSignalRun label="Best kept" run={run()} />}
      </Show>
      <Show when={props.model.nextActionHint}>
        <text fg="#d5c8a2" wrapMode="word">Next: {props.model.nextActionHint}</text>
      </Show>
    </box>
  )
}

function AutoresearchDurabilityCard(props: { model: AutoresearchTuiViewModel }) {
  return (
    <Show when={props.model.durabilityIssueCount > 0 || props.model.durabilityBackupCount > 0}>
      <box border borderColor={props.model.durabilityRecoveryRequired ? "#c45c43" : "#3d3d3d"} flexDirection="column" gap={1} padding={1} title="Durability">
        <text fg={props.model.durabilityRecoveryRequired ? "#f1a287" : "#8dcf9f"}>
          {props.model.durabilityRecoveryRequired
            ? "Recovery required before loop mutations."
            : props.model.durabilityIssueCount > 0
              ? "Durability warnings detected."
              : "Backups are available for recovery."}
        </text>
        <text fg="#aab5c4">Backups: {props.model.durabilityBackupCount}</text>
        <For each={props.model.durabilityIssues}>
          {(issue) => (
            <box flexDirection="column" gap={0}>
              <text fg={issue.severity === "error" ? "#f1a287" : "#d8b15a"} wrapMode="word">{issue.message}</text>
              <Show when={issue.recovery}>
                <text fg="#d5c8a2" wrapMode="word">{issue.recovery}</text>
              </Show>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function AutoresearchSignalRun(props: {
  label: string
  run: NonNullable<AutoresearchTuiViewModel["baselineRun"]>
}) {
  return (
    <box flexDirection="column" gap={0}>
      <text fg="#d6dde6">{props.label}: #{props.run.iteration} · s{props.run.segment} · {props.run.metric}</text>
      <Show when={props.run.relativeChange}>
        <text fg="#8dcf9f">{props.run.relativeChange}</text>
      </Show>
      <Show when={props.run.confidence}>
        <text fg="#aab5c4">Confidence: {props.run.confidence}</text>
      </Show>
      <Show when={props.run.summary}>
        <text fg="#f3ede2" wrapMode="word">{props.run.summary}</text>
      </Show>
      <Show when={props.run.asiSummary}>
        <text fg="#d5c8a2" wrapMode="word">ASI: {props.run.asiSummary}</text>
      </Show>
    </box>
  )
}

function useAutoresearchModel(projectDir: () => string) {
  const [model, setModel] = createSignal<ReturnType<typeof buildAutoresearchTuiViewModel>>()
  let preferredWorkDir: string | undefined

  async function refresh() {
    const snapshot = await loadAutoresearchWorkspaceSnapshot(projectDir(), preferredWorkDir)
    preferredWorkDir = snapshot?.paths.directory
    setModel(snapshot ? buildAutoresearchTuiViewModel(snapshot) : undefined)
  }

  createEffect(() => {
    void projectDir()
    void refresh()
  })

  const interval = setInterval(() => {
    void refresh()
  }, SIDEBAR_POLL_MS)

  onCleanup(() => {
    clearInterval(interval)
  })

  return model
}

function modeColor(mode: "active" | "off" | "paused" | undefined): string {
  switch (mode) {
    case "active":
      return "#8dcf9f"
    case "paused":
      return "#d8b15a"
    case "off":
      return "#8a8f98"
    default:
      return "#aab5c4"
  }
}

function getCurrentSessionID(api: Parameters<NonNullable<TuiPluginModule["tui"]>>[0]): string | undefined {
  const current = api.route.current
  if (current.name !== "session") return undefined
  return typeof current.params?.sessionID === "string" ? current.params.sessionID : undefined
}