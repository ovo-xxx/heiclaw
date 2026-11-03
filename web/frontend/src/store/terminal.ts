import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

export const TERMINAL_PANEL_OPEN_STORAGE_KEY = "picoclaw.terminal.open"
export const TERMINAL_PANEL_HEIGHT_STORAGE_KEY = "picoclaw.terminal.height"
export const TERMINAL_LAYOUT_STORAGE_KEY = "picoclaw.terminal.layout"

export const DEFAULT_TERMINAL_PANEL_OPEN = false
export const DEFAULT_TERMINAL_PANEL_HEIGHT = 260
export const TERMINAL_PANEL_MIN_HEIGHT = 120
export const TERMINAL_PANEL_MAX_VH = 0.72

/**
 * Layout skeleton of the terminal workspace: splits remember their orientation
 * and children, tabsets remember only how many tabs they held. Tab ids are
 * deliberately not persisted - a browser tab id names a live PTY socket, and
 * after a reload the shell is necessarily a new one, so restoring structure with
 * fresh sessions beats restoring ids that point at nothing.
 */
export type TerminalLayoutSkeletonNode =
  | { type: "tabset"; tabs: number }
  | {
      type: "split"
      orientation: "horizontal" | "vertical"
      children: TerminalLayoutSkeletonNode[]
    }

export type TerminalLayoutSkeleton = TerminalLayoutSkeletonNode

const DEFAULT_TERMINAL_LAYOUT: TerminalLayoutSkeleton = {
  type: "tabset",
  tabs: 1,
}

/**
 * The dock keeps its size, its open flag and the pane layout in storage so a
 * reload lands where the user left off.
 */
export const terminalPanelOpenAtom = atomWithStorage<boolean>(
  TERMINAL_PANEL_OPEN_STORAGE_KEY,
  DEFAULT_TERMINAL_PANEL_OPEN,
  undefined,
  { getOnInit: true },
)

export const terminalPanelHeightAtom = atomWithStorage<number>(
  TERMINAL_PANEL_HEIGHT_STORAGE_KEY,
  DEFAULT_TERMINAL_PANEL_HEIGHT,
  undefined,
  { getOnInit: true },
)

export const terminalLayoutAtom = atomWithStorage<TerminalLayoutSkeleton>(
  TERMINAL_LAYOUT_STORAGE_KEY,
  DEFAULT_TERMINAL_LAYOUT,
  undefined,
  { getOnInit: true },
)

/** Full-height mode, the mobile answer to splitting. */
export const terminalPanelExpandedAtom = atom(false)
