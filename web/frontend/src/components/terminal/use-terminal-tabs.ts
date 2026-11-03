import { useSyncExternalStore } from "react"

import {
  type TerminalTabInfo,
  terminalManager,
} from "@/components/terminal/terminal-manager"

/** Live tab list, kept outside React so sockets survive re-renders. */
export function useTerminalTabs(): TerminalTabInfo[] {
  return useSyncExternalStore(
    terminalManager.subscribe,
    terminalManager.getSnapshot,
    terminalManager.getSnapshot,
  )
}
