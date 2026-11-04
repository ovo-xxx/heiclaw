import { IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"
import dayjs from "dayjs"
import { useAtomValue } from "jotai"
import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  type SessionSearchMatch,
  type SessionSummary,
  searchSessions,
} from "@/api/sessions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { newChatSession, switchChatSession } from "@/features/chat/controller"
import { useSessionHistory } from "@/hooks/use-session-history"
import { cn } from "@/lib/utils"
import { activeSessionIdAtom, isTypingAtom } from "@/store/chat"

type ConversationGroupId = "today" | "yesterday" | "last7days" | "earlier"

const GROUP_ORDER: ConversationGroupId[] = [
  "today",
  "yesterday",
  "last7days",
  "earlier",
]

const GROUP_LABEL_KEYS: Record<ConversationGroupId, string> = {
  today: "chat.dateGroup.today",
  yesterday: "chat.dateGroup.yesterday",
  last7days: "chat.dateGroup.last7Days",
  earlier: "chat.dateGroup.earlier",
}

function resolveGroupId(updatedAt: string): ConversationGroupId {
  const updated = dayjs(updatedAt)
  if (!updated.isValid()) {
    return "earlier"
  }

  const dayDiff = dayjs().startOf("day").diff(updated.startOf("day"), "day")

  if (dayDiff <= 0) return "today"
  if (dayDiff === 1) return "yesterday"
  if (dayDiff < 7) return "last7days"
  return "earlier"
}

export function ConversationList() {
  const { t } = useTranslation()
  const { isMobile, setOpenMobile } = useSidebar()
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [contentMatches, setContentMatches] =
    React.useState<SessionSearchMatch[] | null>(null)
  const [searching, setSearching] = React.useState(false)

  // Search goes to the backend once the query is long enough: titles are filtered
  // locally, but message content has to be read from the stored sessions.
  React.useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2) {
      setContentMatches(null)
      setSearching(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      searchSessions(needle)
        .then((matches) => {
          if (!cancelled) setContentMatches(matches)
        })
        .catch(() => {
          if (!cancelled) setContentMatches([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const handleDeletedActiveSession = React.useCallback(() => {
    void newChatSession()
    navigate({ to: "/" })
  }, [navigate])

  const {
    sessions,
    hasMore,
    loadError,
    loadErrorMessage,
    observerRef,
    loadSessions,
    handleDeleteSession,
  } = useSessionHistory({
    activeSessionId,
    onDeletedActiveSession: handleDeletedActiveSession,
  })

  const isTyping = useAtomValue(isTypingAtom)
  const wasTypingRef = React.useRef(false)
  React.useEffect(() => {
    // A finished turn is what persists a session, so refresh the list then
    // instead of polling.
    if (wasTypingRef.current && !isTyping) {
      void loadSessions(true)
    }
    wasTypingRef.current = isTyping
  }, [isTyping, loadSessions])

  const filteredSessions = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return sessions
    }

    return sessions.filter((session) => {
      // The backend has no search endpoint, so filter the loaded page locally.
      return (
        session.title.toLowerCase().includes(needle) ||
        session.preview.toLowerCase().includes(needle)
      )
    })
  }, [query, sessions])

  const groupedSessions = React.useMemo(() => {
    const buckets: Record<ConversationGroupId, SessionSummary[]> = {
      today: [],
      yesterday: [],
      last7days: [],
      earlier: [],
    }

    for (const session of filteredSessions) {
      buckets[resolveGroupId(session.updated)].push(session)
    }

    return GROUP_ORDER.map((id) => ({ id, items: buckets[id] })).filter(
      (group) => group.items.length > 0,
    )
  }, [filteredSessions])

  const handleSelectSession = React.useCallback(
    (sessionId: string) => {
      void switchChatSession(sessionId)
      // Each conversation has its own URL, so the address bar is a shareable link to
      // what is on screen - and picking one from /config or /models brings the user
      // back to the chat route rather than appearing to do nothing.
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId },
        search: { at: undefined },
      })
      if (isMobile) {
        setOpenMobile(false)
      }
    },
    [isMobile, navigate, setOpenMobile],
  )

  // A result opens the conversation at the message that matched, and the chat page
  // scrolls to it. The local title/date filter still runs underneath for short lists.
  const handleOpenMatch = React.useCallback(
    (match: SessionSearchMatch) => {
      void switchChatSession(match.session_id)
      navigate({
        to: "/chat/$sessionId",
        params: { sessionId: match.session_id },
        search: { at: match.index },
      })
      if (isMobile) {
        setOpenMobile(false)
      }
    },
    [isMobile, navigate, setOpenMobile],
  )

  const handleNewChat = React.useCallback(() => {
    void newChatSession()
    navigate({ to: "/" })
    if (isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, navigate, setOpenMobile])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidebarHeader className="gap-2 px-3 pt-2 pb-2">
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
      </SidebarHeader>

      <div
        role="navigation"
        aria-label={t("chat.conversations")}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
      >
        {contentMatches !== null ? (
          <div className="flex flex-col gap-0.5 pt-1">
            {searching && contentMatches.length === 0 && (
              <p className="text-muted-foreground px-1 py-2 text-xs">
                {t("chat.searching")}
              </p>
            )}
            {!searching && contentMatches.length === 0 && (
              <p className="text-muted-foreground px-1 py-2 text-xs">
                {t("chat.noMatchingConversations")}
              </p>
            )}
            {contentMatches.map((match, index) => (
              <button
                key={`${match.session_id}-${match.index}-${index}`}
                type="button"
                onClick={() => handleOpenMatch(match)}
                className="hover:bg-accent/60 flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors"
              >
                <span className="text-foreground/85 truncate text-xs font-medium">
                  {match.title || t("chat.untitledConversation")}
                </span>
                <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
                  {match.role === "user" ? "› " : ""}
                  {match.snippet}
                </span>
              </button>
            ))}
          </div>
        ) : (
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            {loadError && (
              <p className="text-destructive px-1 py-2 text-xs">
                {loadErrorMessage}
              </p>
            )}

            {!loadError && sessions.length === 0 && (
              <p className="text-muted-foreground px-1 py-2 text-xs">
                {t("chat.noHistory")}
              </p>
            )}

            {!loadError &&
              sessions.length > 0 &&
              groupedSessions.length === 0 && (
                <p className="text-muted-foreground px-1 py-2 text-xs">
                  {t("chat.noMatchingConversations")}
                </p>
              )}

            {groupedSessions.map((group) => (
              <div key={group.id} className="mb-2">
                <p className="text-muted-foreground/80 px-1 py-1 text-xs font-medium">
                  {t(GROUP_LABEL_KEYS[group.id])}
                </p>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((session) => {
                    const isActive = session.id === activeSessionId
                    return (
                      <SidebarMenuItem key={session.id}>
                        <SidebarMenuButton
                          isActive={isActive}
                          onClick={() => handleSelectSession(session.id)}
                          className={cn(
                            "h-auto items-start rounded-md px-3 py-2",
                            // Active background comes from the sidebar
                            // primitive's data-active styles.
                            isActive
                              ? "font-medium"
                              : "text-muted-foreground hover:bg-muted/60",
                          )}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-sm">
                              {session.title}
                            </span>
                            <span
                              className={cn(
                                "text-muted-foreground/80 truncate text-xs",
                                isActive && "opacity-80",
                              )}
                            >
                              {dayjs(session.updated).fromNow()}
                              {" · "}
                              {t("chat.messagesCount", {
                                count: session.message_count,
                              })}
                            </span>
                          </span>
                        </SidebarMenuButton>
                        <SidebarMenuAction
                          showOnHover
                          aria-label={t("chat.deleteSession")}
                          onClick={() => void handleDeleteSession(session.id)}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive top-2"
                        >
                          <IconTrash className="size-4" />
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </div>
            ))}

            {hasMore && sessions.length > 0 && (
              <div ref={observerRef} className="py-2 text-center">
                <span className="text-muted-foreground animate-pulse text-xs">
                  {t("chat.loadingMore")}
                </span>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
        )}
      </div>
    </div>
  )
}
