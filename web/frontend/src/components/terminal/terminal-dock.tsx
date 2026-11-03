import { IconChevronDown } from "@tabler/icons-react"
import { useAtom, useSetAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { terminalManager } from "@/components/terminal/terminal-manager"
import { subscribeTerminalTheme } from "@/components/terminal/terminal-theme"
import { TerminalWorkspace } from "@/components/terminal/terminal-workspace"
import { useTerminalTabs } from "@/components/terminal/use-terminal-tabs"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  TERMINAL_PANEL_MAX_VH,
  TERMINAL_PANEL_MIN_HEIGHT,
  terminalPanelExpandedAtom,
  terminalPanelHeightAtom,
  terminalPanelOpenAtom,
} from "@/store/terminal"

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export function TerminalDock() {
  const { t } = useTranslation()
  const [open] = useAtom(terminalPanelOpenAtom)
  const setOpen = useSetAtom(terminalPanelOpenAtom)
  const [storedHeight, setStoredHeight] = useAtom(terminalPanelHeightAtom)
  const [expanded, setExpanded] = useAtom(terminalPanelExpandedAtom)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startHeight: number }>({
    startY: 0,
    startHeight: 0,
  })

  // Closing the last tab is the same intent as closing the panel; an open
  // panel with no shell in it should not exist.
  const tabs = useTerminalTabs()
  useEffect(() => {
    if (open && tabs.length === 0) {
      setOpen(false)
      setExpanded(false)
    }
  }, [open, tabs.length, setExpanded, setOpen])

  useEffect(() => {
    terminalManager.applyTheme()
    return subscribeTerminalTheme(() => terminalManager.applyTheme())
  }, [])

  const maxHeight = () =>
    Math.max(
      TERMINAL_PANEL_MIN_HEIGHT,
      Math.round(window.innerHeight * TERMINAL_PANEL_MAX_VH),
    )

  const measuredHeight = () =>
    Math.round(
      containerRef.current?.getBoundingClientRect().height ?? storedHeight,
    )

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (expanded) {
      setExpanded(false)
    }
    dragRef.current = { startY: event.clientY, startHeight: measuredHeight() }
    setDragHeight(dragRef.current.startHeight)
  }

  const moveDrag = (event: React.PointerEvent) => {
    if (dragRef.current.startHeight === 0) {
      return
    }
    setDragHeight(
      clamp(
        dragRef.current.startHeight + (dragRef.current.startY - event.clientY),
        TERMINAL_PANEL_MIN_HEIGHT,
        maxHeight(),
      ),
    )
  }

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current.startHeight === 0) {
      return
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = { startY: 0, startHeight: 0 }
    if (dragHeight !== null) {
      setStoredHeight(dragHeight)
    }
    setDragHeight(null)
  }

  const collapse = () => {
    setOpen(false)
    setExpanded(false)
  }

  const height =
    dragHeight !== null
      ? `${dragHeight}px`
      : expanded
        ? `calc(100vh - ${TERMINAL_PANEL_MIN_HEIGHT * 3}px)`
        : `${clamp(storedHeight, TERMINAL_PANEL_MIN_HEIGHT, maxHeight())}px`

  return (
    // Hidden, never unmounted, while collapsed: the PTY sockets live in the
    // manager and xterm keeps its geometry through display:none, so reopening
    // the dock shows the very same shell instead of a fresh PTY.
    <section
      aria-label={t("navigation.terminal")}
      className={cn("z-10 shrink-0", !open && "hidden")}
    >
      <div
        ref={containerRef}
        style={{ height }}
        className="border-border/60 bg-card flex w-full flex-col overflow-hidden border-t shadow-sm"
      >
        <div
          role="separator"
          aria-label={t("pages.terminal.resizePanel")}
          aria-orientation="horizontal"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="group border-border hover:bg-primary/30 flex h-1.5 shrink-0 cursor-row-resize touch-none items-center justify-center border-b transition-colors"
        >
          <span className="bg-muted-foreground/30 group-hover:bg-primary/60 h-0.5 w-10 rounded-full" />
        </div>

        <TerminalWorkspace variant="dock" className="min-h-0 flex-1" />

        <div className="border-border flex shrink-0 items-center justify-end gap-2 border-t px-2 py-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={collapse}
            title={t("pages.terminal.hidePanel")}
            aria-label={t("pages.terminal.hidePanel")}
          >
            <IconChevronDown className="size-4" />
          </Button>
        </div>
      </div>
    </section>
  )
}
