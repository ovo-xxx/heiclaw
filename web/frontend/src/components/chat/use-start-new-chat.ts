import { useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useCallback } from "react"

import { useSidebar } from "@/components/ui/sidebar"
import { newChatSession } from "@/features/chat/controller"
import { conversationQueryAtom } from "@/store/chat"

// Starting a fresh conversation means the same four things wherever it is triggered
// from - the composer button or the sidebar logo: clear the session, clear the search,
// go to the chat route, and close the drawer on a phone.
export function useStartNewChat() {
  const navigate = useNavigate()
  const setQuery = useSetAtom(conversationQueryAtom)
  const { isMobile, setOpenMobile } = useSidebar()

  return useCallback(() => {
    void newChatSession()
    setQuery("")
    navigate({ to: "/" })
    if (isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, navigate, setOpenMobile, setQuery])
}
