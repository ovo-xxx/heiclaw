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
  | { type: "user"; index: number; message: ChatMessage }
  | { type: "activity"; index: number; key: string; messages: ChatMessage[] }
  | { type: "assistant"; index: number; message: ChatMessage }

export function buildRenderItems(
  messages: ChatMessage[],
  visibility: AssistantDetailVisibility,
): RenderItem[] {
  const items: RenderItem[] = []
  let activity: ChatMessage[] | undefined
  let activityIndex = 0

  const flush = () => {
    if (activity && activity.length > 0) {
      // The first block's id is stable while later blocks stream in, so expanding a
      // row does not lose its state mid-turn.
      items.push({
        type: "activity",
        key: activity[0].id,
        index: activityIndex,
        messages: activity,
      })
    }
    activity = undefined
  }

  messages.forEach((message, index) => {
    if (message.role !== "assistant") {
      flush()
      items.push({ type: "user", index, message })
      return
    }

    const kind = message.kind ?? "normal"
    if (kind === "thought" || kind === "tool_calls") {
      if (shouldShowAssistantMessage(visibility, kind)) {
        if (!activity) {
          activity = []
          activityIndex = index
        }
        activity.push(message)
      }
      return
    }

    flush()
    items.push({ type: "assistant", index, message })
  })

  flush()
  return items
}

// The tool records of the turn that starts at startIndex: the first following message
// that carries stats, stopping at the next user message so a later turn never lends
// its numbers to this one.
export function toolStatsForTurn(
  messages: ChatMessage[],
  startIndex: number,
): TurnToolStat[] {
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === "user") {
      return []
    }
    if (message.stats?.tools?.length) {
      return message.stats.tools
    }
  }
  return []
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
  // What the model said it was about to do, when it said one.
  explanation?: string
  timestamp?: string | number
  modelName?: string
}

// A row is one thing the turn did: a stretch of reasoning, or one tool call. Tool
// calls carry their own duration and outcome, matched to the turn record by the
// provider's call id.
export function buildActivityRows(
  messages: ChatMessage[],
  toolStats: TurnToolStat[] = [],
): ActivityRow[] {
  const rows: ActivityRow[] = []

  for (const message of messages) {
    const kind = message.kind ?? "normal"

    if (kind === "thought") {
      const content = message.content.trim()
      if (!content) {
        continue
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
      continue
    }

    if (kind !== "tool_calls") {
      continue
    }

    // Tool records live on the turn's answer, not on this block; the caller passes
    // them in so a row can show its own duration and outcome.
    const byCallId = new Map(
      toolStats
        .filter((tool) => tool.call_id)
        .map((tool) => [tool.call_id, tool]),
    )
    const unclaimed = toolStats.filter((tool) => !tool.call_id)

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
        explanation:
          toolCall.extraContent?.toolFeedbackExplanation?.trim() ?? "",
        timestamp: message.timestamp,
        modelName: message.modelName,
      })
    })
  }

  return rows
}
