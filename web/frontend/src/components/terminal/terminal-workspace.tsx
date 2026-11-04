import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconLayoutColumns,
  IconLayoutRows,
  IconPlus,
  IconX,
} from "@tabler/icons-react"
import { useAtom } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type TabNode,
  Workspace,
  type WorkspaceImperativeHandle,
} from "react-resizable-panels"

import {
  type TerminalTabStatus,
  terminalManager,
} from "@/components/terminal/terminal-manager"
import { TerminalPane } from "@/components/terminal/terminal-pane"
import { useTerminalTabs } from "@/components/terminal/use-terminal-tabs"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  type TerminalGroupState,
  type TerminalGroupsState,
  type TerminalLayoutSkeletonNode,
  terminalGroupColor,
  terminalGroupsAtom,
  terminalPanelExpandedAtom,
} from "@/store/terminal"

interface TerminalWorkspaceProps {
  /** The dock keeps its own collapse control in the shared header. */
  variant: "dock" | "page"
  className?: string
}

/**
 * The workspace tree we render and read. It is the shape the library both accepts
 * as `defaultModel` and reports back through `onModelChanged`, narrowed to the
 * fields the panel actually uses.
 */
type LayoutNode =
  | {
      type: "tabset"
      id: string
      tabs: TabNode<string>[]
      selectedId?: string
    }
  | {
      type: "split"
      id: string
      orientation: "horizontal" | "vertical"
      children: LayoutNode[]
    }

interface LayoutModel {
  version: 1
  root: LayoutNode
  maximizedTabsetId?: string
}

const statusColor: Record<TerminalTabStatus, string> = {
  connecting: "bg-amber-400",
  open: "bg-emerald-500",
  exited: "bg-zinc-500",
  failed: "bg-red-500",
}

function tabTitle(id: string): string {
  return terminalManager.label(id) || id
}

function newGroupId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID()
  }
  return `group-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Live model from the stored skeleton: each tabset slot gets a real session, and a
 * slot whose shell is gone (after a reload) gets a fresh one. Tab ids are never
 * stored, so the structure survives while the processes are honestly new.
 */
function buildModel(
  skeleton: TerminalLayoutSkeletonNode,
  pool: string[],
): LayoutModel {
  let seed = 0

  const walk = (node: TerminalLayoutSkeletonNode): LayoutNode => {
    seed += 1
    if (node.type === "tabset") {
      const tabs: TabNode<string>[] = []
      for (let index = 0; index < Math.max(1, node.tabs); index += 1) {
        const id = pool.shift() ?? terminalManager.createTab()
        tabs.push({ id, title: tabTitle(id), data: id })
      }
      return { type: "tabset", id: `tabset-${seed}`, tabs }
    }
    return {
      type: "split",
      id: `split-${seed}`,
      orientation: node.orientation,
      children: node.children.map(walk),
    }
  }

  return { version: 1, root: walk(skeleton) }
}

function toSkeleton(node: LayoutNode): TerminalLayoutSkeletonNode {
  if (node.type === "tabset") {
    return { type: "tabset", tabs: node.tabs.length }
  }
  return {
    type: "split",
    orientation: node.orientation,
    children: node.children.map(toSkeleton),
  }
}

function walkTabsets(
  node: LayoutNode,
  visit: (tabset: Extract<LayoutNode, { type: "tabset" }>) => void,
) {
  if (node.type === "tabset") {
    visit(node)
    return
  }
  for (const child of node.children) {
    walkTabsets(child, visit)
  }
}

function firstTabsetId(node: LayoutNode): string | undefined {
  let found: string | undefined
  walkTabsets(node, (tabset) => {
    found ??= tabset.id
  })
  return found
}

function collectTabsetIds(
  node: LayoutNode,
  into = new Set<string>(),
): Set<string> {
  walkTabsets(node, (tabset) => into.add(tabset.id))
  return into
}

/** Which pane (tabset) holds this tab — the split/append target. */
function tabsetIdOfTab(node: LayoutNode, tabId: string): string | undefined {
  let found: string | undefined
  walkTabsets(node, (tabset) => {
    if (!found && tabset.tabs.some((tab) => tab.id === tabId)) {
      found = tabset.id
    }
  })
  return found
}

function countTabs(node: LayoutNode): number {
  let total = 0
  walkTabsets(node, (tabset) => {
    total += tabset.tabs.length
  })
  return total
}

function collectTabIds(
  node: LayoutNode,
  into = new Set<string>(),
): Set<string> {
  walkTabsets(node, (tabset) => {
    for (const tab of tabset.tabs) {
      into.add(tab.id)
    }
  })
  return into
}

/**
 * Terminal groups: each one is a page with its own split tree and its own shells,
 * switched by the coloured marks at the left of the strip. A new group starts as a
 * single pane, so it never joins another group's split.
 */
export function TerminalWorkspace({
  variant,
  className,
}: TerminalWorkspaceProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [groupsState, setGroupsState] = useAtom(terminalGroupsAtom)
  const [expanded, setExpanded] = useAtom(terminalPanelExpandedAtom)
  const [models, setModels] = useState<Record<string, LayoutModel>>({})
  const modelsRef = useRef<Record<string, LayoutModel>>({})
  modelsRef.current = models
  const builtRef = useRef(false)

  // Building a model starts shells. On mount every stored group gets its shells back
  // (fresh processes, same layout); an install with no groups gets one page.
  useEffect(() => {
    if (builtRef.current) {
      return
    }
    builtRef.current = true
    const pool = terminalManager.getSnapshot().map((tab) => tab.id)
    let groups = groupsState.groups
    let activeId = groupsState.activeId
    if (groups.length === 0) {
      groups = [
        {
          id: newGroupId(),
          color: terminalGroupColor(0),
          skeleton: { type: "tabset", tabs: 1 },
        },
      ]
      activeId = groups[0].id
      setGroupsState({ activeId, groups })
    }
    const next: Record<string, LayoutModel> = {}
    for (const group of groups) {
      next[group.id] = buildModel(group.skeleton, pool)
    }
    setModels(next)
    // Skeleton and sessions are read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeId = models[groupsState.activeId]
    ? groupsState.activeId
    : groupsState.groups.find((group) => models[group.id])?.id

  // Shells live in the manager, not in a tree: anything no group still holds is a
  // leaked PTY and is closed here, once, for the union of all groups.
  const reconcile = useCallback((nextModels: Record<string, LayoutModel>) => {
    const alive = new Set<string>()
    for (const model of Object.values(nextModels)) {
      collectTabIds(model.root, alive)
    }
    for (const tab of terminalManager.getSnapshot()) {
      if (!alive.has(tab.id)) {
        terminalManager.closeTab(tab.id)
      }
    }
  }, [])

  const handleModelChanged = useCallback(
    (groupId: string, next: LayoutModel) => {
      setModels((prev) => {
        const merged = { ...prev, [groupId]: next }
        reconcile(merged)
        return merged
      })
      setGroupsState((prev) => ({
        ...prev,
        groups: prev.groups.map((group) =>
          group.id === groupId
            ? { ...group, skeleton: toSkeleton(next.root) }
            : group,
        ),
      }))
      // A group whose last tab went away has nothing left to show.
      if (countTabs(next.root) === 0) {
        queueMicrotask(() => closeGroup(groupId))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reconcile, setGroupsState],
  )

  const closeGroup = useCallback(
    (groupId: string) => {
      const model = modelsRef.current[groupId]
      if (model) {
        for (const tabId of collectTabIds(model.root)) {
          terminalManager.closeTab(tabId)
        }
      }
      setModels((prev) => {
        const next = { ...prev }
        delete next[groupId]
        return next
      })
      setGroupsState((prev) => {
        const groups = prev.groups.filter((group) => group.id !== groupId)
        const activeId =
          prev.activeId === groupId
            ? (groups[groups.length - 1]?.id ?? "")
            : prev.activeId
        return { activeId, groups }
      })
    },
    [setGroupsState],
  )

  const addGroup = useCallback(() => {
    const tabId = terminalManager.createTab()
    const group: TerminalGroupState = {
      id: newGroupId(),
      color: terminalGroupColor(groupsState.groups.length),
      skeleton: { type: "tabset", tabs: 1 },
    }
    const model = buildModel(group.skeleton, [tabId])
    setModels((prev) => ({ ...prev, [group.id]: model }))
    setGroupsState((prev: TerminalGroupsState) => ({
      activeId: group.id,
      groups: [...prev.groups, group],
    }))
  }, [groupsState.groups.length, setGroupsState])

  const selectGroup = useCallback(
    (groupId: string) => {
      setGroupsState((prev) => ({ ...prev, activeId: groupId }))
    },
    [setGroupsState],
  )

  const hasModels = Object.keys(models).length > 0

  return (
    <div
      className={cn(
        "bg-card text-card-foreground flex h-full min-h-0 flex-col overflow-hidden",
        className,
      )}
    >
      {!hasModels ? (
        <div className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-xs">
          <span>{t("pages.terminal.emptyPane")}</span>
          <Button type="button" size="xs" variant="outline" onClick={addGroup}>
            <IconPlus className="size-3" />
            {t("pages.terminal.newGroup")}
          </Button>
        </div>
      ) : (
        groupsState.groups.map((group) =>
          models[group.id] ? (
            <GroupWorkspace
              key={group.id}
              groupId={group.id}
              model={models[group.id]}
              active={group.id === activeId}
              variant={variant}
              isMobile={isMobile}
              expanded={expanded}
              setExpanded={setExpanded}
              groups={groupsState.groups}
              activeGroupId={activeId}
              onSelectGroup={selectGroup}
              onAddGroup={addGroup}
              onCloseGroup={closeGroup}
              onModelChanged={handleModelChanged}
            />
          ) : null,
        )
      )}
    </div>
  )
}

interface GroupWorkspaceProps {
  groupId: string
  model: LayoutModel
  active: boolean
  variant: "dock" | "page"
  isMobile: boolean
  expanded: boolean
  setExpanded: (updater: (value: boolean) => boolean) => void
  groups: TerminalGroupState[]
  activeGroupId?: string
  onSelectGroup: (groupId: string) => void
  onAddGroup: () => void
  onCloseGroup: (groupId: string) => void
  onModelChanged: (groupId: string, next: LayoutModel) => void
}

function GroupWorkspace({
  groupId,
  model,
  active,
  variant,
  isMobile,
  expanded,
  setExpanded,
  groups,
  activeGroupId,
  onSelectGroup,
  onAddGroup,
  onCloseGroup,
  onModelChanged,
}: GroupWorkspaceProps) {
  const { t } = useTranslation()
  const tabs = useTerminalTabs()
  const workspaceRef = useRef<WorkspaceImperativeHandle<
    string,
    unknown
  > | null>(null)
  const [activePaneId, setActivePaneId] = useState<string | undefined>(
    undefined,
  )
  // A split's new pane only exists after the library reports the new model, so the
  // tab we want to focus is remembered here until then.
  const pendingSplitFocusTabId = useRef<string | null>(null)
  const targetTabsetId = activePaneId ?? firstTabsetId(model.root)

  const addTab = useCallback(() => {
    const workspace = workspaceRef.current
    if (!workspace) {
      return
    }
    const id = terminalManager.createTab()
    if (
      !workspace.addTab(
        { id, title: tabTitle(id), data: id },
        { select: true, tabsetId: targetTabsetId },
      )
    ) {
      terminalManager.closeTab(id)
    }
  }, [targetTabsetId])

  const closeTab = useCallback((id: string) => {
    workspaceRef.current?.closeTab(id)
    terminalManager.closeTab(id)
  }, [])

  // Splitting acts on the pane you are looking at: a fresh shell is created and
  // dropped onto that tabset's own edge, which nests it in a new split.
  const splitActiveTabset = useCallback(
    (orientation: "horizontal" | "vertical") => {
      if (isMobile) {
        setExpanded((value) => !value)
        return
      }
      const workspace = workspaceRef.current
      if (!workspace || !targetTabsetId) {
        return
      }
      const id = terminalManager.createTab()
      if (
        !workspace.addTab(
          { id, title: tabTitle(id), data: id },
          { select: true, tabsetId: targetTabsetId },
        )
      ) {
        terminalManager.closeTab(id)
        return
      }
      workspace.moveTab(id, {
        tabsetId: targetTabsetId,
        region: orientation === "horizontal" ? "right" : "bottom",
      })
      pendingSplitFocusTabId.current = id
    },
    [isMobile, setExpanded, targetTabsetId],
  )

  const tabsets: Extract<LayoutNode, { type: "tabset" }>[] = []
  walkTabsets(model.root, (tabset) => tabsets.push(tabset))
  const paneCount = tabsets.length

  return (
    <div
      className={cn(
        "min-h-0 flex-1 flex-col",
        active ? "flex" : "hidden",
      )}
    >
      {/* One header strip per group: the library's own per-tabset header (44px each)
          is hidden in index.css so splitting never multiplies it. The group marks
          sit at the left, then that group's tabs. */}
      <div className="border-border flex h-7 min-w-0 shrink-0 items-center border-b">
        <GroupMarks
          groups={groups}
          activeGroupId={activeGroupId}
          onSelect={onSelectGroup}
          onAdd={onAddGroup}
          onClose={onCloseGroup}
        />
        <div className="flex min-w-0 flex-1 scrollbar-none items-center gap-0.5 overflow-x-auto ps-1">
          {tabsets.map((tabset, paneIndex) =>
            tabset.tabs.map((tab) => {
              const info = tabs.find((item) => item.id === tab.id)
              const selected = tabset.selectedId
                ? tabset.selectedId === tab.id
                : tabset.tabs[0]?.id === tab.id
              return (
                <TerminalTabChip
                  key={tab.id}
                  id={tab.id}
                  label={tabTitle(tab.id)}
                  status={info?.status}
                  selected={selected}
                  focused={active && targetTabsetId === tabset.id}
                  paneNumber={paneCount > 1 ? paneIndex + 1 : null}
                  onSelect={() => {
                    setActivePaneId(tabset.id)
                    workspaceRef.current?.selectTab(tab.id)
                  }}
                  onClose={() => closeTab(tab.id)}
                />
              )
            }),
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 px-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={addTab}
            title={t("pages.terminal.newTab")}
            aria-label={t("pages.terminal.newTab")}
          >
            <IconPlus className="size-3.5" />
          </Button>
          {variant === "dock" && !isMobile && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => splitActiveTabset("horizontal")}
                title={t("pages.terminal.splitHorizontal")}
                aria-label={t("pages.terminal.splitHorizontal")}
              >
                <IconLayoutColumns className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => splitActiveTabset("vertical")}
                title={t("pages.terminal.splitVertical")}
                aria-label={t("pages.terminal.splitVertical")}
              >
                <IconLayoutRows className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setExpanded((value) => !value)}
                title={t(
                  expanded
                    ? "pages.terminal.restoreHeight"
                    : "pages.terminal.expand",
                )}
                aria-label={t(
                  expanded
                    ? "pages.terminal.restoreHeight"
                    : "pages.terminal.expand",
                )}
              >
                {expanded ? (
                  <IconArrowsMinimize className="size-3.5" />
                ) : (
                  <IconArrowsMaximize className="size-3.5" />
                )}
              </Button>
            </>
          )}
          {isMobile && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setExpanded((value) => !value)}
              title={t(
                expanded
                  ? "pages.terminal.restoreHeight"
                  : "pages.terminal.expand",
              )}
              aria-label={t(
                expanded
                  ? "pages.terminal.restoreHeight"
                  : "pages.terminal.expand",
              )}
            >
              {expanded ? (
                <IconArrowsMinimize className="size-3.5" />
              ) : (
                <IconArrowsMaximize className="size-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Workspace
          workspaceRef={workspaceRef}
          defaultModel={model}
          onModelChanged={(next) => {
            const changed = next
            onModelChanged(groupId, changed)
            const liveTabsets = collectTabsetIds(changed.root)
            setActivePaneId((current) => {
              const pending = pendingSplitFocusTabId.current
              if (pending) {
                const pane = tabsetIdOfTab(changed.root, pending)
                if (pane) {
                  pendingSplitFocusTabId.current = null
                  return pane
                }
              }
              return current && liveTabsets.has(current) ? current : undefined
            })
          }}
          renderTabContent={(tab) => (
            <TerminalPane
              tabId={tab.id}
              className="min-h-0"
              onPointerDown={() =>
                setActivePaneId(tabsetIdOfTab(model.root, tab.id))
              }
            />
          )}
          tabPlacement="top"
          hiddenTabBehavior="keep-mounted"
          disableDrop={isMobile}
          tabRemovalSelectionBehavior="adjacent"
          className="h-full min-h-0"
        />
      </div>
    </div>
  )
}

// Coloured marks, one per group: filled means active, a ring means it exists. No
// names, the way Chrome marks tab groups.
function GroupMarks({
  groups,
  activeGroupId,
  onSelect,
  onAdd,
  onClose,
}: {
  groups: TerminalGroupState[]
  activeGroupId?: string
  onSelect: (groupId: string) => void
  onAdd: () => void
  onClose: (groupId: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="border-border/60 flex shrink-0 items-center gap-1 border-r px-1.5">
      {groups.map((group, index) => {
        const active = group.id === activeGroupId
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => onSelect(group.id)}
            aria-label={t("pages.terminal.groupMarks", { number: index + 1 })}
            aria-pressed={active}
            title={t("pages.terminal.groupMarks", { number: index + 1 })}
            className={cn(
              "size-3 shrink-0 rounded-[3px] border transition-opacity",
              active ? "opacity-100" : "opacity-60 hover:opacity-90",
            )}
            style={{
              borderColor: group.color,
              backgroundColor: active ? group.color : "transparent",
            }}
          />
        )
      })}
      <button
        type="button"
        onClick={onAdd}
        aria-label={t("pages.terminal.newGroup")}
        title={t("pages.terminal.newGroup")}
        className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center rounded-sm transition-colors"
      >
        <IconPlus className="size-3" />
      </button>
      {activeGroupId && (
        <button
          type="button"
          onClick={() => onClose(activeGroupId)}
          aria-label={t("pages.terminal.closeGroup")}
          title={t("pages.terminal.closeGroup")}
          className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center rounded-sm transition-colors"
        >
          <IconX className="size-3" />
        </button>
      )}
    </div>
  )
}

interface TerminalTabChipProps {
  id: string
  label: string
  status?: TerminalTabStatus
  selected: boolean
  // The pane this tab lives in holds the keyboard focus. With a single tab on screen
  // every chip looks the same, so this is what answers "which terminal am I typing
  // into" once the panel is split.
  focused: boolean
  paneNumber: number | null
  onSelect: () => void
  onClose: () => void
}

function TerminalTabChip({
  id,
  label,
  status,
  selected,
  focused,
  paneNumber,
  onSelect,
  onClose,
}: TerminalTabChipProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div
      data-terminal-tab={id}
      onMouseDown={(event) => {
        // Middle button: stop the browser's autoscroll so the click can close us.
        if (event.button === 1) {
          event.preventDefault()
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          onClose()
        }
      }}
      className={cn(
        "group relative flex h-6 max-w-[190px] min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs",
        // Only the focused shell is marked, and only by the underline drawn below:
        // a filled background made the active tab read as dimmed next to the others.
        focused && selected
          ? "text-foreground"
          : "text-foreground/65 hover:bg-accent/50 hover:text-foreground",
      )}
      aria-current={focused && selected ? "true" : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status ? statusColor[status] : "bg-zinc-500",
        )}
      />
      {paneNumber !== null && (
        <span className="text-foreground/50 shrink-0 text-[10px] tabular-nums">
          {paneNumber}
        </span>
      )}
      {draft !== null ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim()) {
              terminalManager.renameTab(id, draft.trim())
            }
            setDraft(null)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur()
            } else if (event.key === "Escape") {
              setDraft(null)
            }
          }}
          className="bg-background text-foreground w-24 rounded border px-1 text-xs outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => setDraft(label)}
          title={status ? t(`pages.terminal.status.${status}`) : undefined}
          className="min-w-0 flex-1 truncate text-left"
        >
          {label}
        </button>
      )}
      <button
        type="button"
        aria-label={t("pages.terminal.closeTab")}
        title={t("pages.terminal.closeTab")}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
        className="text-foreground/50 hover:text-foreground shrink-0 rounded-sm p-0.5 leading-none opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      >
        <IconX className="size-3" />
      </button>
      {selected && focused && (
        // A straight indicator, not an inset shadow: a shadow follows the chip's
        // rounded corners and reads as a floating crescent under the label.
        <span
          aria-hidden
          className="bg-primary/70 absolute inset-x-1.5 -bottom-px h-[2px] rounded-full"
        />
      )}
    </div>
  )
}
