import { createFileRoute } from "@tanstack/react-router"

import { ChatPage } from "@/components/chat/chat-page"

// One address per conversation, so a link can point at a specific chat. `at` is the
// message a content search matched, which the page scrolls to and flashes.
export const Route = createFileRoute("/chat/$sessionId")({
  validateSearch: (search: Record<string, unknown>) => ({
    at:
      typeof search.at === "number" && Number.isFinite(search.at)
        ? Math.max(0, Math.trunc(search.at))
        : undefined,
  }),
  component: ChatSessionPage,
})

function ChatSessionPage() {
  const { sessionId } = Route.useParams()
  return <ChatPage sessionId={sessionId} />
}
