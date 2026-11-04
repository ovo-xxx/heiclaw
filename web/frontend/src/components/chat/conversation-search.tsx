import { IconPlus, IconSearch, IconX } from "@tabler/icons-react"
import { useAtom } from "jotai"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSidebar } from "@/components/ui/sidebar"
import { newChatSession } from "@/features/chat/controller"
import { conversationQueryAtom } from "@/store/chat"

// New chat and search sit directly under the logo, above the navigation, the way the
// ChatGPT sidebar orders them. The query is shared with the list rendered further down.
export function ConversationSearch() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const [query, setQuery] = useAtom(conversationQueryAtom)

  const closeDrawer = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  const handleNewChat = () => {
    void newChatSession()
    setQuery("")
    navigate({ to: "/" })
    closeDrawer()
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-2">
      <Button
        size="sm"
        onClick={handleNewChat}
        className="h-9 w-full justify-center gap-2"
      >
        <IconPlus className="size-4" />
        <span>{t("chat.newChat")}</span>
      </Button>

      <div className="relative">
        <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-70" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chat.searchConversations")}
          aria-label={t("chat.searchConversations")}
          className="border-border/60 h-9 bg-transparent pr-8 pl-8 text-sm"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("chat.clearSearch")}
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2"
          >
            <IconX className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
