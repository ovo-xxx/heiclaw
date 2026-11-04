import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconLayoutColumns,
  IconLayoutRows,
  IconPlus,
  IconX,
} from "@tabler/icons-react"
import { useAtom, useSetAtom } from "jotai"
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
  type TerminalLayoutSkeletonNode,
  terminalLayoutAtom,
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

export function TerminalWorkspace({
  variant,
  className,
}: TerminalWorkspaceProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const tabs = useTerminalTabs()
  const [layout] = useAtom(terminalLayoutAtom)
  const setLayout = useSetAtom(terminalLayoutAtom)
  const [expanded, setExpanded] = useAtom(terminalPanelExpandedAtom)
  const workspaceRef = useRef<WorkspaceImperativeHandle<
    string,
    unknown
  > | null>(null)

  // Building the model starts shells, so it happens in an effect (twice in
  // StrictMode dev otherwise) and the workspace only mounts once it exists.
  const [model, setModel] = useState<LayoutModel | null>(null)
  const builtRef = useRef(false)

  useEffect(() => {
    if (builtRef.current) {
      return
    }
    builtRef.current = true
    setModel(
      buildModel(
        layout,
        terminalManager.getSnapshot().map((tab) => tab.id),
      ),
    )
    // Skeleton and sessions are read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sockets live in the manager, not in this tree: the last view to unmount takes
  // them down, so a hidden dock keeps its shells but a route change does not
  // leave them running.
  useEffect(() => {
    terminalManager.retain()
    return () => {
      terminalManager.release()
    }
  }, [])

  const [activePaneId, setActivePaneId] = useState<string | undefined>(
    undefined,
  )
  // A split's new pane only exists after the library reports the new model, so the
  // tab we want to focus is remembered here until then.
  const pendingSplitFocusTabId = useRef<string | null>(null)
  const targetTabsetId =
    activePaneId ?? (model ? firstTabsetId(model.root) : undefined)

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


  // Closing the last tab empties the model while the dock toggle can still create
  // a shell; without this the two disagree and a live session has no tab.
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !model) {
      return
    }
    if (tabs.length > 0 && countTabs(model.root) === 0) {
      for (const tab of tabs) {
        workspace.addTab({ id: tab.id, title: tabTitle(tab.id), data: tab.id })
      }
    }
  }, [model, tabs])

  if (!model) {
    return null
  }

  const tabsets: Extract<LayoutNode, { type: "tabset" }>[] = []
  walkTabsets(model.root, (tabset) => tabsets.push(tabset))
  const paneCount = tabsets.length

  return (
    <div
      className={cn(
        "bg-card text-card-foreground flex h-full min-h-0 flex-col overflow-hidden",
        className,
      )}
    >
      {/* One header strip for the whole panel. The library's per-tabset header
          (44px each) is hidden in index.css so splitting never multiplies it. */}
      <div className="border-border flex h-7 min-w-0 shrink-0 items-center border-b">
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
                  focused={targetTabsetId === tabset.id}
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
            setModel(changed)
            setLayout(toSkeleton(changed.root))
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
            // The library closes tabs on its own, so the model is the only truth
            // about which shells should still exist: anything the manager holds
            // that is no longer in the tree is a leaked PTY.
            const alive = collectTabIds(changed.root)
            for (const tab of terminalManager.getSnapshot()) {
              if (!alive.has(tab.id)) {
                terminalManager.closeTab(tab.id)
              }
            }
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
