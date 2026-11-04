import { useAtom, useSetAtom } from "jotai"
import { useCallback } from "react"

import {
  terminalPanelExpandedAtom,
  terminalPanelOpenAtom,
} from "@/store/terminal"

/**
 * The conversation-side control: one button opens and closes the dock. Opening an
 * empty dock is not answered here - the workspace owns layouts, and a shell without
 * a slot in one is a shell nothing can show or close.
 */
export function useTerminalPanelToggle() {
  const [open, setOpen] = useAtom(terminalPanelOpenAtom)
  const setExpanded = useSetAtom(terminalPanelExpandedAtom)

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current
      if (!next) {
        setExpanded(false)
      }
      return next
    })
  }, [setOpen, setExpanded])

  return { open, toggle }
}
