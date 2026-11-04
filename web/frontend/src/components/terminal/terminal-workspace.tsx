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
  type TerminalGroupsState,
  type TerminalLayoutSkeletonNode,
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

type GroupHandle = WorkspaceImperativeHandle<string, unknown>

type Tabset = Extract<LayoutNode, { type: "tabset" }>

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

function walkTabsets(node: LayoutNode, visit: (tabset: Tabset) => void) {
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

function collectTabsetIds(node: LayoutNode, into = new Set<string>()) {
  walkTabsets(node, (tabset) => into.add(tabset.id))
  return into
}

/** Which pane (tabset) holds this tab - the split target and the focus owner. */
function tabsetIdOfTab(node: LayoutNode, tabId: string): string | undefined {
  let found: string | undefined
  walkTabsets(node, (tabset) => {
    if (!found && tabset.tabs.some((tab) => tab.id === tabId)) {
      found = tabset.id
    }
  })
  return found
}

function collectTabIds(node: LayoutNode, into = new Set<string>()) {
  walkTabsets(node, (tabset) => {
    for (const tab of tabset.tabs) {
      into.add(tab.id)
    }
  })
  return into
}

function tabsetsOf(node: LayoutNode): Tabset[] {
  const tabsets: Tabset[] = []
  walkTabsets(node, (tabset) => tabsets.push(tabset))
  return tabsets
}

/**
 * Every page of the terminal shares one horizontal strip. A page is one split tree,
 * and joining a page is not a choice you make - it is what splitting does. So the
 * strip draws membership instead of naming or colouring it: the tabs of one page
 * sit under a single bracket, and a lone terminal, which belongs to nothing, is
 * just a chip. Clicking any chip shows its page and focuses that shell.
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
  const [focusedPaneId, setFocusedPaneId] = useState<
    Record<string, string | undefined>
  >({})
  const tabs = useTerminalTabs()
  const handlesRef = useRef<Record<string, GroupHandle | undefined>>({})
  const builtRef = useRef(false)
  // A split's new pane only exists once the library reports the new model, so the
  // tab to focus is remembered here until then.
  const pendingSplitRef = useRef<{ groupId: string; tabId: string } | null>(
    null,
  )

  // Building a model starts shells. On mount every stored page gets its shells back
  // (fresh processes, same layout); an install with no pages gets one terminal.
  useEffect(() => {
    if (builtRef.current) {
      return
    }
    builtRef.current = true
    const pool = terminalManager.getSnapshot().map((tab) => tab.id)
    const groups = groupsState.groups.length
      ? groupsState.groups
      : [
          {
            id: newGroupId(),
            skeleton: { type: "tabset", tabs: 1 } as TerminalLayoutSkeletonNode,
          },
        ]
    if (groups !== groupsState.groups) {
      setGroupsState({ activeId: groups[0].id, groups })
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

  // Shells live in the manager, not in a tree: anything no page still holds is a
  // leaked PTY. Closing is a side effect, so it runs after the commit that changed
  // the trees - never inside the state updater, where a re-run would close shells
  // that the next render was about to put back.
  useEffect(() => {
    if (!builtRef.current || Object.keys(models).length === 0) {
      return
    }
    const alive = new Set<string>()
    for (const model of Object.values(models)) {
      collectTabIds(model.root, alive)
    }
    for (const tab of terminalManager.getSnapshot()) {
      if (!alive.has(tab.id)) {
        terminalManager.closeTab(tab.id)
      }
    }
  }, [models])

  const closeGroup = useCallback(
    (groupId: string) => {
      const model = models[groupId]
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
        const nextActive =
          prev.activeId === groupId
            ? (groups[groups.length - 1]?.id ?? "")
            : prev.activeId
        return { activeId: nextActive, groups }
      })
    },
    [models, setGroupsState],
  )

  const handleModelChanged = useCallback(
    (groupId: string, next: LayoutModel) => {
      setModels((prev) => ({ ...prev, [groupId]: next }))
      setGroupsState((prev) => ({
        ...prev,
        groups: prev.groups.map((group) =>
          group.id === groupId
            ? { ...group, skeleton: toSkeleton(next.root) }
            : group,
        ),
      }))
      setFocusedPaneId((prev) => {
        const pending = pendingSplitRef.current
        if (pending?.groupId === groupId) {
          const pane = tabsetIdOfTab(next.root, pending.tabId)
          if (pane) {
            pendingSplitRef.current = null
            return { ...prev, [groupId]: pane }
          }
        }
        const current = prev[groupId]
        if (!current || collectTabsetIds(next.root).has(current)) {
          return prev
        }
        return { ...prev, [groupId]: undefined }
      })
      // A page whose last tab went away has nothing left to show.
      if (collectTabIds(next.root).size === 0) {
        queueMicrotask(() => closeGroup(groupId))
      }
    },
    [setGroupsState, closeGroup],
  )

  // A new terminal opens on its own page, so it never joins somebody else's split.
  const addTerminal = useCallback(() => {
    const tabId = terminalManager.createTab()
    const skeleton: TerminalLayoutSkeletonNode = { type: "tabset", tabs: 1 }
    const group = { id: newGroupId(), skeleton }
    setModels((prev) => ({
      ...prev,
      [group.id]: buildModel(skeleton, [tabId]),
    }))
    setGroupsState((prev: TerminalGroupsState) => ({
      activeId: group.id,
      groups: [...prev.groups, group],
    }))
  }, [setGroupsState])

  const selectTab = useCallback(
    (groupId: string, tabId: string) => {
      setGroupsState((prev) =>
        prev.activeId === groupId ? prev : { ...prev, activeId: groupId },
      )
      // Clicking a tab also says "type here", so the focus marker follows it into
      // that tab's pane; otherwise the underline stays where the last split left it.
      const root = models[groupId]?.root
      if (root) {
        const pane = tabsetIdOfTab(root, tabId)
        setFocusedPaneId((prev) => ({ ...prev, [groupId]: pane }))
      }
      handlesRef.current[groupId]?.selectTab(tabId)
      // The page only becomes visible on the next commit, and xterm cannot take
      // focus inside a display:none subtree, so the keyboard follows one frame later.
      requestAnimationFrame(() => terminalManager.focus(tabId))
    },
    [models, setGroupsState],
  )

  const closeTab = useCallback((groupId: string, tabId: string) => {
    handlesRef.current[groupId]?.closeTab(tabId)
    terminalManager.closeTab(tabId)
  }, [])

  // Splitting acts on the pane you are looking at: a fresh shell is created and
  // dropped on that tabset's own edge, which nests it in a new split - and joins it
  // to the page that pane already belongs to.
  const splitActivePane = useCallback(
    (groupId: string, orientation: "horizontal" | "vertical") => {
      if (isMobile) {
        setExpanded((value) => !value)
        return
      }
      const workspace = handlesRef.current[groupId]
      const root = models[groupId]?.root
      const target =
        focusedPaneId[groupId] ?? (root ? firstTabsetId(root) : undefined)
      if (!workspace || !target) {
        return
      }
      const id = terminalManager.createTab()
      if (
        !workspace.addTab(
          { id, title: tabTitle(id), data: id },
          { select: true, tabsetId: target },
        )
      ) {
        terminalManager.closeTab(id)
        return
      }
      workspace.moveTab(id, {
        tabsetId: target,
        region: orientation === "horizontal" ? "right" : "bottom",
      })
      pendingSplitRef.current = { groupId, tabId: id }
    },
    [focusedPaneId, isMobile, models, setExpanded],
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
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={addTerminal}
          >
            <IconPlus className="size-3" />
            {t("pages.terminal.newGroup")}
          </Button>
        </div>
      ) : (
        <>
          <div className="border-border flex min-h-8 items-end gap-1 border-b px-1 pt-1">
            <div className="flex min-w-0 flex-1 scrollbar-none items-end gap-1 overflow-x-auto">
              {groupsState.groups.map((group) => {
                const model = models[group.id]
                if (!model) {
                  return null
                }
                const tabsets = tabsetsOf(model.root)
                const isActive = group.id === activeId
                // One tab has nothing to join; two or more earn the bracket.
                const joined =
                  tabsets.length > 1 || (tabsets[0]?.tabs.length ?? 0) > 1
                const focused =
                  focusedPaneId[group.id] ?? firstTabsetId(model.root)
                return (
                  <div
                    key={group.id}
                    data-terminal-group={group.id}
                    className={cn(
                      "flex min-w-0 shrink-0 items-center gap-0.5",
                      joined &&
                        "border-foreground/25 rounded-t-[7px] border-[1.5px] border-b-0 px-1 pt-px",
                      joined && isActive && "bg-accent/50",
                    )}
                  >
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
                            active={isActive}
                            focused={isActive && focused === tabset.id}
                            paneNumber={
                              tabsets.length > 1 ? paneIndex + 1 : null
                            }
                            onSelect={() => selectTab(group.id, tab.id)}
                            onClose={() => closeTab(group.id, tab.id)}
                          />
                        )
                      }),
                    )}
                    {joined && (
                      <button
                        type="button"
                        onClick={() => closeGroup(group.id)}
                        aria-label={t("pages.terminal.closeGroup")}
                        title={t("pages.terminal.closeGroup")}
                        className="text-foreground/45 hover:text-foreground flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors"
                      >
                        <IconX className="size-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={addTerminal}
                title={t("pages.terminal.newGroup")}
                aria-label={t("pages.terminal.newGroup")}
              >
                <IconPlus className="size-3.5" />
              </Button>
              {!isMobile && activeId && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => splitActivePane(activeId, "horizontal")}
                    title={t("pages.terminal.splitHorizontal")}
                    aria-label={t("pages.terminal.splitHorizontal")}
                  >
                    <IconLayoutColumns className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => splitActivePane(activeId, "vertical")}
                    title={t("pages.terminal.splitVertical")}
                    aria-label={t("pages.terminal.splitVertical")}
                  >
                    <IconLayoutRows className="size-3.5" />
                  </Button>
                </>
              )}
              {variant === "dock" && (
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

          {groupsState.groups.flatMap((group) => {
            const model = models[group.id]
            if (!model) {
              return []
            }
            return [
              <GroupWorkspace
                key={group.id}
                groupId={group.id}
                model={model}
                active={group.id === activeId}
                onRegister={(handle) => {
                  handlesRef.current[group.id] = handle
                }}
                onFocusPane={(tabId) =>
                  setFocusedPaneId((prev) => ({
                    ...prev,
                    [group.id]: tabsetIdOfTab(model.root, tabId),
                  }))
                }
                onModelChanged={handleModelChanged}
              />,
            ]
          })}
        </>
      )}
    </div>
  )
}

interface GroupWorkspaceProps {
  groupId: string
  model: LayoutModel
  active: boolean
  onRegister: (handle: GroupHandle | undefined) => void
  onFocusPane: (tabId: string) => void
  onModelChanged: (groupId: string, next: LayoutModel) => void
}

/**
 * One page: its split tree, kept mounted while inactive so its panes and shells
 * survive a trip to another page. The strip that lists it lives above, in the
 * shared row, so a tab on a page you are not looking at is still one click away.
 */
function GroupWorkspace({
  groupId,
  model,
  active,
  onRegister,
  onFocusPane,
  onModelChanged,
}: GroupWorkspaceProps) {
  const isMobile = useIsMobile()

  return (
    <div
      data-terminal-page={groupId}
      data-active={active ? "true" : "false"}
      className={cn("min-h-0 flex-1 flex-col", active ? "flex" : "hidden")}
    >
      <Workspace
        workspaceRef={(handle) => onRegister(handle ?? undefined)}
        defaultModel={model}
        onModelChanged={(next) => onModelChanged(groupId, next)}
        renderTabContent={(tab) => (
          <TerminalPane
            tabId={tab.id}
            className="min-h-0"
            onPointerDown={() => onFocusPane(tab.id)}
          />
        )}
        tabPlacement="top"
        hiddenTabBehavior="keep-mounted"
        disableDrop={isMobile}
        tabRemovalSelectionBehavior="adjacent"
        className="h-full min-h-0"
      />
    </div>
  )
}

interface TerminalTabChipProps {
  id: string
  label: string
  status?: TerminalTabStatus
  selected: boolean
  // The page this tab belongs to is the one on screen.
  active: boolean
  // That page's focused pane: with several shells on screen every chip would
  // otherwise look identical, so this answers "which terminal am I typing into".
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
  active,
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
        "group relative flex h-6 max-w-[170px] min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs",
        // Only the shell you are typing into is marked, and only by the underline
        // below: a filled background made it read as dimmed next to the others.
        focused && selected
          ? "text-foreground"
          : "text-foreground/65 hover:bg-accent/50 hover:text-foreground",
        !active && "text-foreground/55",
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
