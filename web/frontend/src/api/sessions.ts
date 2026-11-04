import { launcherFetch } from "@/api/http"

export interface SessionSummary {
  id: string
  title: string
  preview: string
  message_count: number
  /** Model pinned to this conversation; empty/absent means it follows the agent. */
  model?: string
  created: string
  updated: string
}

// The Go struct in pkg/providers/protocoltypes/types.go is the wire shape, so
// these snake_case keys are one contract shared by the session REST message
// object and the pico WebSocket "turn_stats" payload. Both chat paths normalize
// through parseTurnStats, so the panel reads the same fields whether the turn
// just streamed or came from history.
export interface TurnTokens {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  reasoning_tokens?: number
  cost_usd?: number
}

export interface TurnLLMCallStat {
  index: number
  iteration?: number
  model?: string
  provider?: string
  finish_reason?: string
  tokens: TurnTokens
  latency_ms: number
  time_to_first_token_ms?: number
  stream_chunks?: number
  streamed_fallback?: boolean
  retry_attempt?: number
  fallback_attempt?: number
  tool_calls?: number
  content_chars?: number
  started_at_ms?: number
  cost?: TurnCallCost
}

// One call priced against the provider's published table. The split travels with
// the total so a reader can check it, and `peak` says which band was charged.
export interface TurnCallCost {
  currency: string
  amount: number
  input: number
  cache_read: number
  output: number
  peak: boolean
  // The per-million prices the amount was computed with, so the panel can show the
  // multiplication rather than asking the user to trust a number.
  input_rate: number
  cache_read_rate: number
  output_rate: number
  table?: string
  source?: string
}

export interface TurnCost {
  currency: string
  amount: number
  peak_calls?: number
  off_peak_calls?: number
  covered_calls: number
  uncounted_calls?: number
  table?: string
}

export interface TurnToolStat {
  name: string
  ok: boolean
  duration_ms: number
  call_id?: string
}

export interface TurnContextUsage {
  used_tokens: number
  total_tokens: number
  history_tokens?: number
  compress_at_tokens: number
  summarize_at_tokens?: number
  used_percent: number
}

export interface TurnStats {
  duration_ms?: number
  time_to_first_token_ms?: number
  finish_reason?: string
  llm_call_count: number
  tool_iterations: number
  stream_chunks?: number
  dropped_llm_call_count?: number
  dropped_tool_count?: number
  tokens: TurnTokens
  llm_calls?: TurnLLMCallStat[]
  tools?: TurnToolStat[]
  context_usage?: TurnContextUsage
  cost?: TurnCost
}

export interface SessionDetail {
  id: string
  messages: {
    role: "user" | "assistant"
    content: string
    created_at?: string
    kind?: "normal" | "thought" | "tool_calls"
    model_name?: string
    usage?: {
      input_tokens: number
      output_tokens: number
      total_tokens: number
    }
    turn_stats?: TurnStats
    file_changes?: {
      path: string
      diff?: string
      additions: number
      deletions: number
      hunks?: string[]
      old_path?: string
      new_path?: string
      file_lang?: string
      binary?: boolean
    }[]
    media?: string[]
    attachments?: {
      type?: "image" | "audio" | "video" | "file"
      url: string
      filename?: string
      content_type?: string
    }[]
    tool_calls?: {
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
      extra_content?: {
        tool_feedback_explanation?: string
      }
    }[]
  }[]
  summary: string
  /** Model pinned to this conversation, as stored by the gateway. */
  model?: string
  created: string
  updated: string
}

export async function getSessions(
  offset: number = 0,
  limit: number = 20,
): Promise<SessionSummary[]> {
  const params = new URLSearchParams({
    offset: offset.toString(),
    limit: limit.toString(),
  })

  const res = await launcherFetch(`/api/sessions?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch sessions: ${res.status}`)
  }
  return res.json()
}

export async function getSessionHistory(id: string): Promise<SessionDetail> {
  const res = await launcherFetch(`/api/sessions/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch session ${id}: ${res.status}`)
  }
  return res.json()
}

export async function deleteSession(id: string): Promise<void> {
  const res = await launcherFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    throw new Error(`Failed to delete session ${id}: ${res.status}`)
  }
}
