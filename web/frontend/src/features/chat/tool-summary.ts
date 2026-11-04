// One-line summary for a tool call, the way mainstream agent UIs label a call:
// the argument that identifies the work (a command, a path, a query), not the
// whole JSON payload. Unknown shapes fall back to the longest string value.

const SUMMARY_KEY_PRIORITY = [
  "command",
  "cmd",
  "script",
  "path",
  "file",
  "file_path",
  "url",
  "pattern",
  "query",
  "search",
  "question",
  "prompt",
  "message",
  "text",
  "content",
  "task",
  "action",
]

const SUMMARY_MAX = 90

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim()
  if (flat.length <= SUMMARY_MAX) {
    return flat
  }
  return `${flat.slice(0, SUMMARY_MAX - 1)}…`
}

export function summarizeToolArguments(rawArguments?: string): string {
  if (!rawArguments) {
    return ""
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return clip(rawArguments)
  }
  if (!parsed || typeof parsed !== "object") {
    return ""
  }

  const record = parsed as Record<string, unknown>
  const strings = new Map<string, string>()
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim()) {
      strings.set(key, value.trim())
    }
  }
  for (const key of SUMMARY_KEY_PRIORITY) {
    const value = strings.get(key)
    if (value) {
      return clip(value)
    }
  }

  let longest = ""
  for (const value of strings.values()) {
    if (value.length > longest.length) {
      longest = value
    }
  }
  return clip(longest)
}

export function formatToolDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)
    .toString()
    .padStart(2, "0")}s`
}
