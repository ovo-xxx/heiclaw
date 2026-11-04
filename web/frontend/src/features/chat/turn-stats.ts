import {
  type TurnCallCost,
  type TurnContextUsage,
  type TurnCost,
  type TurnLLMCallStat,
  type TurnStats,
  type TurnTokens,
  type TurnToolStat,
} from "@/api/sessions"
import { normalizeUnixTimestamp } from "@/features/chat/state"
import type { ChatMessage, TurnUsage } from "@/store/chat"

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
// is dropped rather than displayed as 0. Sessions written before the backend
// measured turns have no turn_stats at all, so this stays the fallback.
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

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

// A dimension the provider never reported is absent, and the Go encoder drops
// zeros, so an unparsable number and a missing one mean the same thing here.
function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed = toNumber(value)
  return parsed > 0 ? parsed : undefined
}

function toText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function parseTurnTokens(raw: unknown): TurnTokens {
  const obj = toRecord(raw) ?? {}
  const input = toNumber(obj.input_tokens)
  const output = toNumber(obj.output_tokens)
  const total = toNumber(obj.total_tokens)
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total > 0 ? total : input + output,
    cache_read_tokens: toPositiveNumber(obj.cache_read_tokens),
    cache_creation_tokens: toPositiveNumber(obj.cache_creation_tokens),
    reasoning_tokens: toPositiveNumber(obj.reasoning_tokens),
    cost_usd: toPositiveNumber(obj.cost_usd),
  }
}

function parseLLMCallStat(raw: unknown): TurnLLMCallStat | undefined {
  const obj = toRecord(raw)
  if (!obj) {
    return undefined
  }
  return {
    index: toNumber(obj.index),
    iteration: toPositiveNumber(obj.iteration),
    model: toText(obj.model),
    provider: toText(obj.provider),
    finish_reason: toText(obj.finish_reason),
    tokens: parseTurnTokens(obj.tokens),
    latency_ms: toNumber(obj.latency_ms),
    time_to_first_token_ms: toPositiveNumber(obj.time_to_first_token_ms),
    stream_chunks: toPositiveNumber(obj.stream_chunks),
    streamed_fallback: obj.streamed_fallback === true,
    retry_attempt: toPositiveNumber(obj.retry_attempt),
    fallback_attempt: toPositiveNumber(obj.fallback_attempt),
    tool_calls: toPositiveNumber(obj.tool_calls),
    content_chars: toPositiveNumber(obj.content_chars),
    started_at_ms: toPositiveNumber(obj.started_at_ms),
    cost: parseCallCost(obj.cost),
  }
}

function parseCallCost(raw: unknown): TurnCallCost | undefined {
  const obj = toRecord(raw)
  if (!obj) {
    return undefined
  }
  const currency = toText(obj.currency)
  if (!currency) {
    return undefined
  }
  return {
    currency,
    amount: toNumber(obj.amount),
    input: toNumber(obj.input),
    cache_read: toNumber(obj.cache_read),
    output: toNumber(obj.output),
    peak: obj.peak === true,
    input_rate: toNumber(obj.input_rate),
    cache_read_rate: toNumber(obj.cache_read_rate),
    output_rate: toNumber(obj.output_rate),
    table: toText(obj.table),
    source: toText(obj.source),
  }
}

function parseTurnCost(raw: unknown): TurnCost | undefined {
  const obj = toRecord(raw)
  if (!obj) {
    return undefined
  }
  const currency = toText(obj.currency)
  if (!currency) {
    return undefined
  }
  return {
    currency,
    amount: toNumber(obj.amount),
    peak_calls: toPositiveNumber(obj.peak_calls),
    off_peak_calls: toPositiveNumber(obj.off_peak_calls),
    covered_calls: toNumber(obj.covered_calls),
    uncounted_calls: toPositiveNumber(obj.uncounted_calls),
    table: toText(obj.table),
  }
}

function parseLLMCalls(raw: unknown): TurnLLMCallStat[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }
  const calls: TurnLLMCallStat[] = []
  for (const item of raw) {
    const call = parseLLMCallStat(item)
    if (call) {
      calls.push({ ...call, index: call.index || calls.length + 1 })
    }
  }
  return calls.length > 0 ? calls : undefined
}

function parseToolStatItem(raw: unknown): TurnToolStat | undefined {
  const obj = toRecord(raw)
  const name = obj ? toText(obj.name) : undefined
  if (!obj || !name) {
    return undefined
  }
  return {
    name,
    call_id: toText(obj.call_id),
    ok: obj.ok !== false,
    duration_ms: toNumber(obj.duration_ms),
  }
}

function parseToolStats(raw: unknown): TurnToolStat[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }
  const tools: TurnToolStat[] = []
  for (const item of raw) {
    const tool = parseToolStatItem(item)
    if (tool) {
      tools.push(tool)
    }
  }
  return tools.length > 0 ? tools : undefined
}

// The interim "tool_results" frame carries the same Go ToolStat shape as the
// turn's final stats, one record per finished call.
export function parseToolStatRecord(raw: unknown): TurnToolStat | undefined {
  return parseToolStatItem(raw)
}

function parseTurnContextUsage(raw: unknown): TurnContextUsage | undefined {
  const obj = toRecord(raw)
  if (!obj) {
    return undefined
  }
  const total = toNumber(obj.total_tokens)
  if (total <= 0) {
    return undefined
  }
  const used = toNumber(obj.used_tokens)
  return {
    used_tokens: used,
    total_tokens: total,
    history_tokens: toPositiveNumber(obj.history_tokens),
    compress_at_tokens: toNumber(obj.compress_at_tokens),
    summarize_at_tokens: toPositiveNumber(obj.summarize_at_tokens),
    used_percent:
      toPositiveNumber(obj.used_percent) ?? Math.round((used / total) * 100),
  }
}

// The one producer of TurnStats for both paths: the pico WebSocket payload key
// "turn_stats" and the session REST message object carry the identical Go
// struct, so normalizing here keeps their field names from ever diverging.
export function parseTurnStats(raw: unknown): TurnStats | undefined {
  const obj = toRecord(raw)
  if (!obj) {
    return undefined
  }

  const tokens = parseTurnTokens(obj.tokens)
  const llmCalls = parseLLMCalls(obj.llm_calls)
  const durationMs = toPositiveNumber(obj.duration_ms)
  if (
    durationMs === undefined &&
    llmCalls === undefined &&
    tokens.total_tokens <= 0
  ) {
    return undefined
  }

  return {
    duration_ms: durationMs,
    time_to_first_token_ms: toPositiveNumber(obj.time_to_first_token_ms),
    finish_reason: toText(obj.finish_reason),
    llm_call_count: toNumber(obj.llm_call_count) || (llmCalls?.length ?? 0),
    tool_iterations: toNumber(obj.tool_iterations),
    stream_chunks: toPositiveNumber(obj.stream_chunks),
    dropped_llm_call_count: toPositiveNumber(obj.dropped_llm_call_count),
    dropped_tool_count: toPositiveNumber(obj.dropped_tool_count),
    tokens,
    llm_calls: llmCalls,
    tools: parseToolStats(obj.tools),
    context_usage: parseTurnContextUsage(obj.context_usage),
    cost: parseTurnCost(obj.cost),
  }
}

// The backend measures the turn itself; the timestamp difference is only the
// fallback for turns recorded before turn_stats existed.
export function turnDurationMs(
  stats?: TurnStats,
  elapsedMs?: number,
): number | undefined {
  return stats?.duration_ms ?? elapsedMs
}

export function turnTotalTokens(stats?: TurnStats, usage?: TurnUsage): number {
  return stats?.tokens.total_tokens || usage?.total_tokens || 0
}

export function formatTokenCount(value: number): string {
  const count = Math.round(value)
  const magnitude = Math.abs(count)
  if (magnitude >= 1_000_000) {
    return `${trimFraction(count / 1_000_000)}M`
  }
  if (magnitude >= 1_000) {
    return `${trimFraction(count / 1_000)}K`
  }
  return String(count)
}

// The abbreviated number is for scanning; the exact count belongs where it can
// still be read, so every caller that folds it into a label passes this as title.
export function formatTokenExact(value: number): string {
  return Math.round(value).toLocaleString()
}

function trimFraction(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

// Decode speed for one call: the tokens the model wrote over the window in which
// it was actually writing. The wait for the first token and any tool execution
// stay out of the denominator, or a slow tool would read as a slow model.
export function callOutputRate(call: TurnLLMCallStat): number | undefined {
  const tokens = call.tokens.output_tokens
  const windowMs = call.latency_ms - (call.time_to_first_token_ms ?? 0)
  if (tokens <= 0 || windowMs <= 250) {
    return undefined
  }
  return (tokens * 1000) / windowMs
}

// Turn-level speed weights nothing but generation: it sums the output tokens and
// the generation windows of the calls that reported both. Undefined when no call
// measured a window, rather than a zero that would read as a stalled model.
export function turnOutputRate(stats?: TurnStats): number | undefined {
  let tokens = 0
  let windowMs = 0
  for (const call of stats?.llm_calls ?? []) {
    if (callOutputRate(call) === undefined) {
      continue
    }
    tokens += call.tokens.output_tokens
    windowMs += call.latency_ms - (call.time_to_first_token_ms ?? 0)
  }
  if (tokens <= 0 || windowMs <= 250) {
    return undefined
  }
  return (tokens * 1000) / windowMs
}

// Cache hit share of the prompt. InputTokens is the fresh part only and
// CacheReadTokens the part served from cache, so the two together are what the
// provider read as input. Undefined when the turn never reported a cache count:
// "0%" would claim the cache missed, when the truth is it was never measured.
export function turnCacheHitPercent(stats?: TurnStats): number | undefined {
  const tokens = stats?.tokens
  const cached = tokens?.cache_read_tokens
  if (cached === undefined) {
    return undefined
  }
  const prompt = (tokens?.input_tokens ?? 0) + cached
  if (prompt <= 0) {
    return undefined
  }
  return (cached / prompt) * 100
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

export function formatTokenRate(perSecond: number): string {
  const digits = perSecond >= 100 ? 0 : 1
  return `${perSecond.toFixed(digits)} tok/s`
}

export function formatCostUsd(value: number): string {
  if (value <= 0) {
    return ""
  }
  const digits = value >= 1 ? 2 : 4
  return `$${value.toFixed(digits).replace(/\.?0+$/, "")}`
}

const CURRENCY_SIGNS: Record<string, string> = {
  CNY: "￥",
  USD: "$",
}

export function currencySign(currency: string): string {
  return CURRENCY_SIGNS[currency] ?? `${currency} `
}

// Money is shown in the currency the price table bills in. A DeepSeek turn costs
// fractions of a fen, so small amounts keep four decimals instead of collapsing to
// ￥0.00, which would read as a free turn.
export function formatCost(currency: string, amount: number): string {
  if (!(amount > 0)) {
    return ""
  }
  return `${currencySign(currency)}${amount.toFixed(amount >= 1 ? 2 : 4)}`
}

// Amounts inside a calculation breakdown keep every decimal they have, so the sum
// of the rows visibly equals the total instead of rounding twice.
export function formatCostExact(currency: string, amount: number): string {
  return `${currencySign(currency)}${amount.toFixed(6)}`
}

// Cost of a turn: the computed amount when the price table covered its calls,
// otherwise the figure a provider reported for itself.
export function turnCostText(stats?: TurnStats): string {
  if (stats?.cost) {
    return formatCost(stats.cost.currency, stats.cost.amount)
  }
  return formatCostUsd(stats?.tokens.cost_usd ?? 0)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`
  }
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} m ${String(seconds).padStart(2, "0")} s`
}
