import { useAtom, useSetAtom } from "jotai"
import { useCallback } from "react"

import { terminalManager } from "@/components/terminal/terminal-manager"
import {
  terminalPanelExpandedAtom,
  terminalPanelOpenAtom,
} from "@/store/terminal"

/**
 * The conversation-side control: one button opens and closes the dock, and
 * opening an empty dock drops you straight into a shell instead of an empty
 * pane.
 */
export function useTerminalPanelToggle() {
  const [open, setOpen] = useAtom(terminalPanelOpenAtom)
  const setExpanded = useSetAtom(terminalPanelExpandedAtom)

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current
      if (next && terminalManager.getSnapshot().length === 0) {
        terminalManager.createTab()
      }
      if (!next) {
        setExpanded(false)
      }
      return next
    })
  }, [setOpen, setExpanded])

  return { open, toggle }
}
