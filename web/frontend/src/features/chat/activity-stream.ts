import type { TurnToolStat } from "@/api/sessions"
import type { AssistantDetailVisibility } from "@/features/chat/detail-visibility"
import { shouldShowAssistantMessage } from "@/features/chat/detail-visibility"
import { toolActivity } from "@/features/chat/tool-labels"
import { summarizeToolArguments } from "@/features/chat/tool-summary"
import type { ChatMessage, ChatToolCall } from "@/store/chat"

// One turn streams several assistant blocks - a thought here, a tool call there -
// and each used to become its own card, so a turn with eight actions pushed eight
// headers down the page. They are now collected into one activity stream per turn,
// and the answer that closes the turn stays its own bubble.

export type RenderItem =
  | { type: "user"; message: ChatMessage }
  | { type: "activity"; key: string; messages: ChatMessage[] }
  | { type: "assistant"; message: ChatMessage }

export function buildRenderItems(
  messages: ChatMessage[],
  visibility: AssistantDetailVisibility,
): RenderItem[] {
  const items: RenderItem[] = []
  let activity: ChatMessage[] | undefined

  const flush = () => {
    if (activity && activity.length > 0) {
      // The first block's id is stable while later blocks stream in, so expanding a
      // row does not lose its state mid-turn.
      items.push({ type: "activity", key: activity[0].id, messages: activity })
    }
    activity = undefined
  }

  for (const message of messages) {
    if (message.role !== "assistant") {
      flush()
      items.push({ type: "user", message })
      continue
    }

    const kind = message.kind ?? "normal"
    if (kind === "thought" || kind === "tool_calls") {
      if (shouldShowAssistantMessage(visibility, kind)) {
        ;(activity ??= []).push(message)
      }
      continue
    }

    flush()
    items.push({ type: "assistant", message })
  }

  flush()
  return items
}

export interface ActivityRow {
  id: string
  kind: "thought" | "tool"
  labelKey?: string
  fallbackLabel: string
  summary: string
  durationMs?: number
  ok?: boolean
  content?: string
  toolCall?: ChatToolCall
  timestamp?: string | number
  modelName?: string
}

// A row is one thing the turn did: a stretch of reasoning, or one tool call. Tool
// calls carry their own duration and outcome, matched to the turn record by the
// provider's call id.
export function buildActivityRows(messages: ChatMessage[]): ActivityRow[] {
  const rows: ActivityRow[] = []

  messages.forEach((message, messageIndex) => {
    const kind = message.kind ?? "normal"

    if (kind === "thought") {
      const content = message.content.trim()
      if (!content) {
        return
      }
      rows.push({
        id: `thought-${message.id}`,
        kind: "thought",
        fallbackLabel: "thought",
        summary: content.replace(/\s+/g, " "),
        content,
        timestamp: message.timestamp,
        modelName: message.modelName,
      })
      return
    }

    if (kind !== "tool_calls") {
      return
    }

    const stats = message.stats?.tools ?? []
    const byCallId = new Map(
      stats.filter((tool) => tool.call_id).map((tool) => [tool.call_id, tool]),
    )
    const unclaimed = stats.filter((tool) => !tool.call_id)

    ;(message.toolCalls ?? []).forEach((toolCall, callIndex) => {
      const name = toolCall.function?.name?.trim() ?? ""
      const summary = summarizeToolArguments(toolCall.function?.arguments)
      if (!name && !summary) {
        return
      }
      const record: TurnToolStat | undefined =
        (toolCall.id ? byCallId.get(toolCall.id) : undefined) ??
        (unclaimed[callIndex]?.name === name ? unclaimed[callIndex] : undefined)
      const activity = toolActivity(name)

      rows.push({
        id: `tool-${message.id}-${toolCall.id ?? callIndex}`,
        kind: "tool",
        labelKey: activity.labelKey,
        fallbackLabel: activity.fallbackLabel,
        summary,
        durationMs: record?.duration_ms,
        ok: record?.ok,
        toolCall,
        timestamp: message.timestamp,
        modelName: message.modelName,
        // A tool_calls block also carries the model's own note about the call.
        content: messageIndex >= 0 ? undefined : undefined,
      })
    })
  })

  return rows
}
