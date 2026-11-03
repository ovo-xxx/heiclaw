import { atomWithStorage } from "jotai/utils"

export const SIDEBAR_GROUPS_OPEN_STORAGE_KEY = "picoclaw.sidebar.groups"

export type SidebarGroupsOpenState = Record<string, boolean>

export const DEFAULT_SIDEBAR_GROUPS_OPEN: SidebarGroupsOpenState = {}

export const sidebarGroupsOpenAtom = atomWithStorage<SidebarGroupsOpenState>(
  SIDEBAR_GROUPS_OPEN_STORAGE_KEY,
  DEFAULT_SIDEBAR_GROUPS_OPEN,
  undefined,
  { getOnInit: true },
)
