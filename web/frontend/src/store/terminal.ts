import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

export const TERMINAL_PANEL_OPEN_STORAGE_KEY = "picoclaw.terminal.open"
export const TERMINAL_PANEL_HEIGHT_STORAGE_KEY = "picoclaw.terminal.height"
export const TERMINAL_GROUPS_STORAGE_KEY = "picoclaw.terminal.groups"

export const DEFAULT_TERMINAL_PANEL_OPEN = false
export const DEFAULT_TERMINAL_PANEL_HEIGHT = 260
export const TERMINAL_PANEL_MIN_HEIGHT = 120
export const TERMINAL_PANEL_MAX_VH = 0.72

/**
 * Layout skeleton of one terminal group: splits remember their orientation and
 * children, tabsets remember only how many tabs they held. Tab ids are deliberately
 * not persisted - a browser tab id names a live PTY socket, and after a reload the
 * shell is necessarily a new one, so restoring structure with fresh sessions beats
 * restoring ids that point at nothing.
 */
export type TerminalLayoutSkeletonNode =
  | { type: "tabset"; tabs: number }
  | {
      type: "split"
      orientation: "horizontal" | "vertical"
      children: TerminalLayoutSkeletonNode[]
    }

export type TerminalLayoutSkeleton = TerminalLayoutSkeletonNode

/**
 * A group is one page of the terminal: its own split tree and its own shells. Groups
 * carry a colour instead of a name, the way Chrome labels tab groups, so the strip
 * stays a row of marks rather than a list of words.
 */
export interface TerminalGroupState {
  id: string
  color: string
  skeleton: TerminalLayoutSkeleton
}

export interface TerminalGroupsState {
  activeId: string
  groups: TerminalGroupState[]
}

export const TERMINAL_GROUP_COLORS = [
  "#8f959e", // grey
  "#1a73e8", // blue
  "#d93025", // red
  "#f9ab00", // yellow
  "#188038", // green
  "#d01884", // pink
  "#7b1fa2", // purple
  "#007b83", // cyan
  "#fa7b17", // orange
] as const

export function terminalGroupColor(index: number): string {
  return TERMINAL_GROUP_COLORS[index % TERMINAL_GROUP_COLORS.length]
}

export const DEFAULT_TERMINAL_GROUPS: TerminalGroupsState = {
  activeId: "",
  groups: [],
}

/**
 * The dock keeps its size and its open flag in storage; the groups keep their
 * skeletons, so a reload lands where the user left off.
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

export const terminalGroupsAtom = atomWithStorage<TerminalGroupsState>(
  TERMINAL_GROUPS_STORAGE_KEY,
  DEFAULT_TERMINAL_GROUPS,
  undefined,
  { getOnInit: true },
)

/** Full-height mode, the mobile answer to splitting. */
export const terminalPanelExpandedAtom = atom(false)
