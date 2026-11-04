import { createFileRoute } from "@tanstack/react-router"

import { ChatPage } from "@/components/chat/chat-page"

// One address per conversation, so a link can point at a specific chat.
export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatSessionPage,
})

function ChatSessionPage() {
  const { sessionId } = Route.useParams()
  return <ChatPage sessionId={sessionId} />
}
