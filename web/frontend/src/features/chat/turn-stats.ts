import { normalizeUnixTimestamp } from "@/features/chat/state"
import type { ChatMessage } from "@/store/chat"

// The user message that opened this turn; assistant messages that follow it
// (thought / tool_calls blocks included) all belong to the same turn.
export function turnStartMessage(
  messages: ChatMessage[],
  index: number,
): ChatMessage | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i]
    }
  }
  return undefined
}

function toMillis(timestamp: number | string | undefined): number | undefined {
  if (timestamp === undefined) {
    return undefined
  }
  if (typeof timestamp === "number") {
    return normalizeUnixTimestamp(timestamp)
  }

  const trimmed = timestamp.trim()
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return normalizeUnixTimestamp(Number(trimmed))
  }

  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

// Duration of one turn: from the user message that started it to the moment the
// assistant answer finished. Both live turns (client clock) and replayed history
// (server created_at) fit this definition; clock skew shows up as a negative and
// is dropped rather than displayed as 0.
export function turnElapsedMs(
  startedAt: number | string | undefined,
  finishedAt: number | string | undefined,
): number | undefined {
  const start = toMillis(startedAt)
  const end = toMillis(finishedAt)
  if (start === undefined || end === undefined) {
    return undefined
  }
  const elapsed = end - start
  return elapsed >= 0 ? elapsed : undefined
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`
}
