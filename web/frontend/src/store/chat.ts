import { atom, getDefaultStore } from "jotai"
import { atomWithStorage } from "jotai/utils"

import type {
  TurnContextUsage,
  TurnStats,
  TurnToolStat,
} from "@/api/sessions"
import {
  ASSISTANT_DETAIL_VISIBILITY_STORAGE_KEY,
  type AssistantDetailVisibility,
  DEFAULT_ASSISTANT_DETAIL_VISIBILITY,
  assistantDetailVisibilityStorage,
} from "@/features/chat/detail-visibility"
import {
  getInitialActiveSessionId,
  writeStoredSessionId,
} from "@/features/chat/state"

export interface ChatAttachment {
  type: "image" | "audio" | "video" | "file"
  url: string
  filename?: string
  contentType?: string
}

export interface ChatToolCallFunction {
  name?: string
  arguments?: string
}

export interface ChatToolCallExtraContent {
  toolFeedbackExplanation?: string
}

export interface ChatToolCall {
  id?: string
  type?: string
  function?: ChatToolCallFunction
  extraContent?: ChatToolCallExtraContent
}

export type AssistantMessageKind = "normal" | "thought" | "tool_calls"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number | string
  kind?: AssistantMessageKind
  modelName?: string
  usage?: TurnUsage
  stats?: TurnStats
  fileChanges?: TurnFileChange[]
  attachments?: ChatAttachment[]
  toolCalls?: ChatToolCall[]
  /**
   * Per-call records the backend announces the moment each tool finishes
   * (kind "tool_results"), merged onto the turn's tool_calls block so a row
   * settles while the turn is still running instead of waiting for the
   * answer's turn_stats.
   */
  toolResults?: TurnToolStat[]
}

export interface TurnUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export interface TurnFileChange {
  path: string
  diff?: string
  additions: number
  deletions: number
  /**
   * Structured hunks (each starting with "@@") produced by the backend. When
   * present, the chat panel renders them through @git-diff-view/react instead
   * of falling back to the raw `diff` string.
   */
  hunks?: string[]
  oldPath?: string
  newPath?: string
  fileLang?: string
  binary?: boolean
}

// The live "context_usage" WebSocket payload and the snapshot inside
// turn_stats carry the same names, so one type serves both.
export type ContextUsage = TurnContextUsage

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"

export interface ChatStoreState {
  messages: ChatMessage[]
  connectionState: ConnectionState
  isTyping: boolean
  activeSessionId: string
  hasHydratedActiveSession: boolean
  contextUsage?: ContextUsage
  /**
   * Model pinned to the active conversation, or null to follow the agent's
   * default. The gateway stores the pin with the session; this mirrors it so the
   * selector reflects a choice before the next turn confirms it.
   */
  sessionModelPin: string | null
}

type ChatStorePatch = Partial<ChatStoreState>

const DEFAULT_CHAT_STATE: ChatStoreState = {
  messages: [],
  connectionState: "disconnected",
  isTyping: false,
  activeSessionId: getInitialActiveSessionId(),
  hasHydratedActiveSession: false,
  sessionModelPin: null,
}

export const chatAtom = atom<ChatStoreState>(DEFAULT_CHAT_STATE)
// Derived so sidebar consumers only re-render on session changes, not on every
// streamed message token.
export const activeSessionIdAtom = atom((get) => get(chatAtom).activeSessionId)
export const sessionModelPinAtom = atom(
  (get) => get(chatAtom).sessionModelPin,
  (_get, _set, value: string | null) => {
    updateChatStore({ sessionModelPin: value })
  },
)
export const isTypingAtom = atom((get) => get(chatAtom).isTyping)

// Thinking effort is chosen per conversation and remembered here only: the gateway
// takes it with each message, so there is no session field to read back. An empty
// value means the model entry's own thinking_level still rules, and nothing is sent.
export const THINKING_LEVELS_STORAGE_KEY = "picoclaw.chat.thinkingLevels"

export const thinkingLevelsBySessionAtom = atomWithStorage<
  Record<string, string>
>(THINKING_LEVELS_STORAGE_KEY, {}, undefined, { getOnInit: true })

export const sessionThinkingLevelAtom = atom(
  (get) => get(thinkingLevelsBySessionAtom)[get(activeSessionIdAtom)] ?? "",
  (get, set, value: string) => {
    const sessionId = get(activeSessionIdAtom)
    set(thinkingLevelsBySessionAtom, {
      ...get(thinkingLevelsBySessionAtom),
      [sessionId]: value,
    })
  },
)
export const assistantDetailVisibilityAtom =
  atomWithStorage<AssistantDetailVisibility>(
    ASSISTANT_DETAIL_VISIBILITY_STORAGE_KEY,
    DEFAULT_ASSISTANT_DETAIL_VISIBILITY,
    assistantDetailVisibilityStorage,
    { getOnInit: true },
  )
export const showAssistantDetailsAtom = atom(
  (get) => get(assistantDetailVisibilityAtom) !== "none",
)

const store = getDefaultStore()

export function getChatState() {
  return store.get(chatAtom)
}

export function updateChatStore(
  patch:
    | ChatStorePatch
    | ((prev: ChatStoreState) => ChatStorePatch | ChatStoreState),
) {
  store.set(chatAtom, (prev) => {
    const nextPatch = typeof patch === "function" ? patch(prev) : patch
    const next = { ...prev, ...nextPatch }

    if (next.activeSessionId !== prev.activeSessionId) {
      writeStoredSessionId(next.activeSessionId)
    }

    return next
  })
}

export { DEFAULT_ASSISTANT_DETAIL_VISIBILITY }
export type { AssistantDetailVisibility }
