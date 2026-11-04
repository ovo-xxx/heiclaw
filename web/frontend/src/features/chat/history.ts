import { getSessionHistory } from "@/api/sessions"
import { parseFileChangeEntry } from "@/features/chat/protocol"
import { normalizeUnixTimestamp } from "@/features/chat/state"
import {
  parseToolCallsValue,
  toolCallsSignature,
} from "@/features/chat/tool-calls"
import { parseTurnStats } from "@/features/chat/turn-stats"
import type {
  ChatAttachment,
  ChatMessage,
  ContextUsage,
  TurnFileChange,
} from "@/store/chat"

function toChatAttachments({
  media,
  attachments,
}: {
  media?: string[]
  attachments?: {
    type?: "image" | "audio" | "video" | "file"
    url: string
    filename?: string
    content_type?: string
  }[]
}): ChatAttachment[] | undefined {
  const normalizedAttachments = attachments
    ?.filter((attachment) => attachment.url)
    .map(
      (attachment) =>
        ({
          type: attachment.type ?? "file",
          url: attachment.url,
          filename: attachment.filename,
          contentType: attachment.content_type,
        }) satisfies ChatAttachment,
    )

  const legacyMediaAttachments = (media ?? [])
    .filter((item) => item.startsWith("data:image/"))
    .map((url) => ({ type: "image" as const, url }))

  const merged = [...(normalizedAttachments ?? []), ...legacyMediaAttachments]

  return merged.length > 0 ? merged : undefined
}

export async function loadSessionMessages(sessionId: string): Promise<{
  messages: ChatMessage[]
  model: string | null
  contextUsage: ContextUsage | undefined
}> {
  const detail = await getSessionHistory(sessionId)
  const messages = detail.messages.map((message, index) => ({
    id: `hist-${index}-${Date.now()}`,
    role: message.role,
    content: message.content,
    kind: message.role === "assistant" ? (message.kind ?? "normal") : undefined,
    modelName: message.model_name,
    usage: message.role === "assistant" ? message.usage : undefined,
    stats:
      message.role === "assistant"
        ? parseTurnStats(message.turn_stats)
        : undefined,
    fileChanges:
      message.role === "assistant"
        ? message.file_changes
            ?.map(parseFileChangeEntry)
            .filter((change): change is TurnFileChange => change !== undefined)
        : undefined,
    toolCalls:
      message.role === "assistant"
        ? parseToolCallsValue(message.tool_calls)
        : undefined,
    attachments: toChatAttachments({
      media: message.media,
      attachments: message.attachments,
    }),
    timestamp: message.created_at ?? detail.updated,
  }))
  // The composer shows the context fill next to the send button, and it has to be
  // right there when a stored session opens - not only after its next turn streams
  // a fresh snapshot. The last turn's snapshot is what the session actually holds.
  let contextUsage: ContextUsage | undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    contextUsage = messages[index].stats?.context_usage
    if (contextUsage) {
      break
    }
  }

  return {
    messages,
    model: detail.model?.trim() || null,
    contextUsage,
  }
}

function normalizeMessageTimestamp(timestamp: number | string): string {
  if (typeof timestamp === "number") {
    return String(normalizeUnixTimestamp(timestamp))
  }

  const trimmed = timestamp.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return String(normalizeUnixTimestamp(Number(trimmed)))
  }

  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? trimmed : String(parsed)
}

function messageSignature(message: ChatMessage): string {
  const attachmentSignature = (message.attachments ?? [])
    .map(
      (attachment) =>
        `${attachment.type}\u0001${attachment.url}\u0001${attachment.filename ?? ""}`,
    )
    .join("\u0002")

  return `${message.role}\u0000${message.content}\u0000${normalizeMessageTimestamp(
    message.timestamp,
  )}\u0000${message.kind ?? ""}\u0000${message.modelName ?? ""}\u0000${attachmentSignature}\u0000${toolCallsSignature(
    message.toolCalls,
  )}`
}

function comparableTimestamp(timestamp: number | string): number {
  const normalized = normalizeMessageTimestamp(timestamp)
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : 0
}

export function mergeHistoryMessages(
  historyMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): ChatMessage[] {
  const currentIds = new Set(currentMessages.map((message) => message.id))
  const currentSignatures = new Set(
    currentMessages.map((message) => messageSignature(message)),
  )

  const merged = [
    ...historyMessages.filter(
      (message) =>
        !currentIds.has(message.id) &&
        !currentSignatures.has(messageSignature(message)),
    ),
    ...currentMessages,
  ]

  return merged.sort(
    (left, right) =>
      comparableTimestamp(left.timestamp) -
      comparableTimestamp(right.timestamp),
  )
}
