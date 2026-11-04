import { toast } from "sonner"

import {
  parseAssistantMessageCreateState,
  parseAssistantMessageUpdateState,
} from "@/features/chat/assistant-message-state"
import { normalizeUnixTimestamp } from "@/features/chat/state"
import { parseToolStatRecord, parseTurnStats } from "@/features/chat/turn-stats"
import {
  type ChatAttachment,
  type ContextUsage,
  type TurnFileChange,
  type TurnUsage,
  updateChatStore,
} from "@/store/chat"

export interface PicoMessage {
  type: string
  id?: string
  session_id?: string
  timestamp?: number | string
  payload?: Record<string, unknown>
}

function parseAttachments(
  payload: Record<string, unknown>,
): ChatAttachment[] | undefined {
  const raw = payload.attachments
  if (!Array.isArray(raw)) {
    return undefined
  }

  const attachments: ChatAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue
    }

    const attachment = item as Record<string, unknown>
    const url = typeof attachment.url === "string" ? attachment.url : ""
    if (!url) {
      continue
    }

    const type =
      attachment.type === "audio" ||
      attachment.type === "video" ||
      attachment.type === "file" ||
      attachment.type === "image"
        ? attachment.type
        : "file"

    const filename =
      typeof attachment.filename === "string" ? attachment.filename : undefined
    const contentType =
      typeof attachment.content_type === "string"
        ? attachment.content_type
        : undefined

    attachments.push({
      type,
      url,
      ...(filename ? { filename } : {}),
      ...(contentType ? { contentType } : {}),
    })
  }

  return attachments.length > 0 ? attachments : undefined
}

function parseContextUsage(
  payload: Record<string, unknown>,
): ContextUsage | undefined {
  const raw = payload.context_usage
  if (!raw || typeof raw !== "object") return undefined
  const obj = raw as Record<string, unknown>
  const used = Number(obj.used_tokens)
  const total = Number(obj.total_tokens)
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0)
    return undefined
  return {
    used_tokens: used,
    total_tokens: total,
    history_tokens:
      obj.history_tokens != null ? Number(obj.history_tokens) : undefined,
    compress_at_tokens: Number(obj.compress_at_tokens) || 0,
    summarize_at_tokens:
      obj.summarize_at_tokens != null
        ? Number(obj.summarize_at_tokens)
        : undefined,
    used_percent: Number(obj.used_percent) || 0,
  }
}

function parseModelName(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.model_name !== "string") {
    return undefined
  }
  const modelName = payload.model_name.trim()
  return modelName || undefined
}

function parseFileChanges(
  payload: Record<string, unknown>,
): TurnFileChange[] | undefined {
  const raw = payload.file_changes
  if (!Array.isArray(raw)) {
    return undefined
  }

  const changes: TurnFileChange[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue
    }
    const change = item as Record<string, unknown>
    const path = typeof change.path === "string" ? change.path : ""
    if (!path) {
      continue
    }
    const hunks = Array.isArray(change.hunks)
      ? change.hunks.filter((h): h is string => typeof h === "string")
      : undefined
    changes.push({
      path,
      ...(typeof change.diff === "string" ? { diff: change.diff } : {}),
      additions: Number(change.additions) || 0,
      deletions: Number(change.deletions) || 0,
      ...(hunks && hunks.length > 0 ? { hunks } : {}),
      ...(typeof change.old_path === "string" && change.old_path
        ? { oldPath: change.old_path }
        : {}),
      ...(typeof change.new_path === "string" && change.new_path
        ? { newPath: change.new_path }
        : {}),
      ...(typeof change.file_lang === "string" && change.file_lang
        ? { fileLang: change.file_lang }
        : {}),
      ...(change.binary === true ? { binary: true } : {}),
    })
  }

  return changes.length > 0 ? changes : undefined
}

function parseTurnUsage(
  payload: Record<string, unknown>,
): TurnUsage | undefined {
  const raw = payload.usage
  if (!raw || typeof raw !== "object") {
    return undefined
  }
  const obj = raw as Record<string, unknown>
  const input = Number(obj.input_tokens)
  const output = Number(obj.output_tokens)
  if (!Number.isFinite(input) || !Number.isFinite(output)) {
    return undefined
  }
  if (input <= 0 && output <= 0) {
    return undefined
  }
  const total = Number(obj.total_tokens)
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number.isFinite(total) && total > 0 ? total : input + output,
  }
}

// The backend announces every finished tool call as its own frame the moment the
// call returns (pkg/channels/pico: a message.create whose kind is "tool_results").
// It is not a row of its own: the record belongs to the call announced earlier in
// the turn, so the feed can settle that row - outcome and duration - while the turn
// is still running, instead of waiting for the answer's turn_stats.
function isToolResultsFrame(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.kind === "string" &&
    payload.kind.trim().toLowerCase() === "tool_results"
  )
}

function applyInterimToolResults(payload: Record<string, unknown>): void {
  const rawResults = payload.tool_results
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return
  }
  const results = rawResults
    .map((item) => parseToolStatRecord(item))
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
  if (results.length === 0) {
    return
  }

  updateChatStore((prev) => {
    let toolCallsIndex = -1
    for (let i = prev.messages.length - 1; i >= 0; i -= 1) {
      const msg = prev.messages[i]
      if (msg.role === "user") {
        break
      }
      if (msg.kind === "tool_calls") {
        toolCallsIndex = i
        break
      }
    }
    if (toolCallsIndex < 0) {
      return {}
    }

    const target = prev.messages[toolCallsIndex]
    const merged = [...(target.toolResults ?? [])]
    for (const result of results) {
      const existing = result.call_id
        ? merged.findIndex((item) => item.call_id === result.call_id)
        : -1
      if (existing >= 0) {
        merged[existing] = result
      } else {
        merged.push(result)
      }
    }

    const messages = [...prev.messages]
    messages[toolCallsIndex] = { ...target, toolResults: merged }
    return { messages }
  })
}

export function handlePicoMessage(
  message: PicoMessage,
  expectedSessionId: string,
) {
  if (message.session_id && message.session_id !== expectedSessionId) {
    return
  }

  const payload = message.payload || {}

  switch (message.type) {
    case "message.create":
    case "media.create": {
      if (isToolResultsFrame(payload)) {
        applyInterimToolResults(payload)
        break
      }
      const messageId = (payload.message_id as string) || `pico-${Date.now()}`
      const { content, kind, toolCalls } =
        parseAssistantMessageCreateState(payload)
      const attachments = parseAttachments(payload)
      const contextUsage = parseContextUsage(payload)
      const isPlaceholder = payload.placeholder === true
      const modelName = parseModelName(payload)
      const turnUsage = parseTurnUsage(payload)
      const stats = parseTurnStats(payload.turn_stats)
      const fileChanges = parseFileChanges(payload)
      const timestamp =
        message.timestamp !== undefined &&
        Number.isFinite(Number(message.timestamp))
          ? normalizeUnixTimestamp(Number(message.timestamp))
          : Date.now()

      updateChatStore((prev) => ({
        messages: [
          ...prev.messages,
          {
            id: messageId,
            role: "assistant",
            content,
            kind,
            ...(modelName ? { modelName } : {}),
            ...(turnUsage ? { usage: turnUsage } : {}),
            ...(stats ? { stats } : {}),
            ...(fileChanges ? { fileChanges } : {}),
            ...(toolCalls ? { toolCalls } : {}),
            attachments,
            timestamp,
          },
        ],
        isTyping:
          !isPlaceholder &&
          (kind === "normal" || message.type === "media.create")
            ? false
            : prev.isTyping,
        ...(contextUsage ? { contextUsage } : {}),
      }))
      break
    }

    case "message.update": {
      const messageId = payload.message_id as string
      const attachments = parseAttachments(payload)
      const contextUsage = parseContextUsage(payload)
      const modelName = parseModelName(payload)
      const turnUsage = parseTurnUsage(payload)
      const stats = parseTurnStats(payload.turn_stats)
      const fileChanges = parseFileChanges(payload)
      const timestamp =
        message.timestamp !== undefined &&
        Number.isFinite(Number(message.timestamp))
          ? normalizeUnixTimestamp(Number(message.timestamp))
          : Date.now()
      if (!messageId) {
        break
      }

      updateChatStore((prev) => ({
        messages: (() => {
          let found = false
          const messages = prev.messages.map((msg) => {
            if (msg.id !== messageId) {
              return msg
            }
            found = true
            const { content, kind, toolCalls } =
              parseAssistantMessageUpdateState(payload, msg)
            return {
              ...msg,
              id: messageId,
              content,
              kind,
              toolCalls,
              ...(modelName ? { modelName } : {}),
              ...(attachments ? { attachments } : {}),
              ...(turnUsage ? { usage: turnUsage, timestamp: Date.now() } : {}),
              ...(stats ? { stats } : {}),
              ...(fileChanges ? { fileChanges } : {}),
            }
          })
          if (found) {
            return messages
          }

          const { content, kind, toolCalls } =
            parseAssistantMessageUpdateState(payload)

          return [
            ...messages,
            {
              id: messageId,
              role: "assistant" as const,
              content,
              kind,
              toolCalls,
              ...(modelName ? { modelName } : {}),
              ...(attachments ? { attachments } : {}),
              ...(turnUsage ? { usage: turnUsage } : {}),
              ...(stats ? { stats } : {}),
              ...(fileChanges ? { fileChanges } : {}),
              timestamp,
            },
          ]
        })(),
        ...(contextUsage ? { contextUsage } : {}),
      }))
      break
    }

    case "message.delete": {
      const messageId = payload.message_id as string
      if (!messageId) {
        break
      }

      updateChatStore((prev) => ({
        messages: prev.messages.filter((msg) => msg.id !== messageId),
      }))
      break
    }

    case "typing.start":
      updateChatStore({ isTyping: true })
      break

    case "typing.stop":
      updateChatStore({ isTyping: false })
      break

    case "error": {
      const requestId =
        typeof payload.request_id === "string" ? payload.request_id : ""
      const errorMessage =
        typeof payload.message === "string" ? payload.message : ""

      console.error("Pico error:", payload)
      if (errorMessage) {
        toast.error(errorMessage)
      }
      updateChatStore((prev) => ({
        messages: requestId
          ? prev.messages.filter((msg) => msg.id !== requestId)
          : prev.messages,
        isTyping: false,
      }))
      break
    }

    case "pong":
      break

    default:
      console.log("Unknown pico message type:", message.type)
  }
}
