import { IconCheck, IconEye, IconTerminal2 } from "@tabler/icons-react"
import { useSearch } from "@tanstack/react-router"
import { useAtom } from "jotai"
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"

import { ActivityFeed } from "@/components/chat/activity-feed"
import { AssistantMessage } from "@/components/chat/assistant-message"
import {
  ChatComposer,
  type ChatInputDisabledReason,
} from "@/components/chat/chat-composer"
import { ChatEmptyState } from "@/components/chat/chat-empty-state"
import { ModelPicker } from "@/components/chat/model-picker"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { UserMessage } from "@/components/chat/user-message"
import { PageHeader } from "@/components/page-header"
import { TerminalDock } from "@/components/terminal/terminal-dock"
import { useTerminalPanelToggle } from "@/components/terminal/use-terminal-panel"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  buildRenderItems,
  toolStatsForTurn,
  turnHasResult,
} from "@/features/chat/activity-stream"
import {
  CHAT_IMAGE_ACCEPT,
  buildChatImageAttachments,
  getTransferredFiles,
  hasFileTransfer,
} from "@/features/chat/image-input"
import { switchChatSession } from "@/features/chat/controller"
import { displayModelName } from "@/features/chat/model-display"
import { turnElapsedMs, turnStartMessage } from "@/features/chat/turn-stats"
import { useChatModels } from "@/hooks/use-chat-models"
import { useGateway } from "@/hooks/use-gateway"
import { usePicoChat } from "@/hooks/use-pico-chat"
import { cn } from "@/lib/utils"
import type { AssistantDetailVisibility } from "@/store/chat"
import type { ConnectionState } from "@/store/chat"
import type { ChatAttachment } from "@/store/chat"
import {
  assistantDetailVisibilityAtom,
  sessionModelPinAtom,
  sessionThinkingLevelAtom,
} from "@/store/chat"
import type { GatewayState } from "@/store/gateway"

function resolveChatInputDisabledReason({
  hasDefaultModel,
  connectionState,
  gatewayState,
}: {
  hasDefaultModel: boolean
  connectionState: ConnectionState
  gatewayState: GatewayState
}): ChatInputDisabledReason | null {
  if (gatewayState === "unknown") {
    return "gatewayUnknown"
  }

  if (gatewayState === "starting") {
    return "gatewayStarting"
  }

  if (gatewayState === "restarting") {
    return "gatewayRestarting"
  }

  if (gatewayState === "stopping") {
    return "gatewayStopping"
  }

  if (gatewayState === "stopped") {
    return "gatewayStopped"
  }

  if (gatewayState === "error") {
    return "gatewayError"
  }

  if (connectionState === "connecting") {
    return "websocketConnecting"
  }

  if (connectionState === "error") {
    return "websocketError"
  }

  if (connectionState === "disconnected") {
    return "websocketDisconnected"
  }

  if (!hasDefaultModel) {
    return "noDefaultModel"
  }

  return null
}

export function ChatPage({ sessionId }: { sessionId?: string } = {}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasScrolled, setHasScrolled] = useState(false)
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const [assistantDetailVisibility, setAssistantDetailVisibility] = useAtom(
    assistantDetailVisibilityAtom,
  )

  const assistantDetailVisibilityOptions: Array<{
    value: AssistantDetailVisibility
    label: string
  }> = [
    { value: "none", label: t("chat.assistantDetailVisibility.none") },
    { value: "thought", label: t("chat.assistantDetailVisibility.thought") },
    {
      value: "tool_calls",
      label: t("chat.assistantDetailVisibility.toolCalls"),
    },
    { value: "all", label: t("chat.assistantDetailVisibility.all") },
  ]

  const { messages, connectionState, isTyping, contextUsage, sendMessage, activeSessionId } =
    usePicoChat()

  const { state: gwState } = useGateway()
  const isGatewayRunning = gwState === "running"
  const { open: terminalOpen, toggle: toggleTerminal } =
    useTerminalPanelToggle()

  const {
    providerOptions,
    defaultModelName,
    hasAvailableModels,
    apiKeyModels,
    oauthModels,
    localModels,
  } = useChatModels({ isConnected: isGatewayRunning })
  const selectableModels = useMemo(
    () => [...apiKeyModels, ...oauthModels, ...localModels],
    [apiKeyModels, oauthModels, localModels],
  )
  const [sessionModelPin, setSessionModelPin] = useAtom(sessionModelPinAtom)
  const [sessionThinkingLevel, setSessionThinkingLevel] = useAtom(
    sessionThinkingLevelAtom,
  )
  // A conversation always names one model: its pin, or the agent's default when it
  // has none. There is no "follow" state left to display.
  const selectedModelName = sessionModelPin ?? defaultModelName
  const selectedModel = useMemo(
    () =>
      selectableModels.find((model) => model.model_name === selectedModelName),
    [selectableModels, selectedModelName],
  )
  const hasDefaultModel = Boolean(defaultModelName)
  const inputDisabledReason = resolveChatInputDisabledReason({
    hasDefaultModel,
    connectionState,
    gatewayState: gwState,
  })
  const canInput = inputDisabledReason === null

  const syncScrollState = (element: HTMLDivElement) => {
    const { clientHeight, scrollHeight, scrollTop } = element
    setHasScrolled(scrollTop > 0)
    setIsAtBottom(scrollHeight - scrollTop <= clientHeight + 10)
  }

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    syncScrollState(e.currentTarget)
  }

  // /chat/<id> is the conversation's address: opening it loads that session, and the
  // list updates the URL as the user picks another one. switchChatSession already
  // ignores the id that is active, so re-renders do not refetch.
  const routedSessionId = sessionId?.trim() ?? ""
  useEffect(() => {
    if (!routedSessionId || routedSessionId === activeSessionId) {
      return
    }
    void switchChatSession(routedSessionId)
  }, [routedSessionId, activeSessionId])

  // A content search result carries `at`: the message to land on once the session is
  // loaded. The flash is the only affordance that tells the eye where the match is.
  const searchParams = useSearch({ strict: false }) as { at?: number }
  const jumpIndex = searchParams.at
  const [flashIndex, setFlashIndex] = useState<number | null>(null)
  useEffect(() => {
    if (jumpIndex === undefined || messages.length === 0) {
      return
    }
    const element = document.querySelector(
      `[data-message-index="${jumpIndex}"]`,
    )
    if (!element) {
      return
    }
    element.scrollIntoView({ block: "center", behavior: "smooth" })
    setFlashIndex(jumpIndex)
    const timer = window.setTimeout(() => setFlashIndex(null), 2400)
    return () => window.clearTimeout(timer)
  }, [jumpIndex, messages.length])

  useEffect(() => {
    if (scrollRef.current) {
      if (isAtBottom) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      syncScrollState(scrollRef.current)
    }
  }, [messages, isTyping, isAtBottom])

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || !canInput) return
    if (
      sendMessage({
        content: input,
        attachments,
      })
    ) {
      setInput("")
      setAttachments([])
    }
  }

  const handleAddImages = () => {
    if (!canInput) return
    fileInputRef.current?.click()
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }

  const appendImageFiles = async (files: readonly File[]) => {
    if (!canInput || files.length === 0) {
      return
    }

    const nextAttachments = await buildChatImageAttachments(files, t)
    if (nextAttachments.length === 0) {
      return
    }

    setAttachments((prev) => [...prev, ...nextAttachments])
  }

  const handleImageSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""

    if (files.length === 0) {
      return
    }

    await appendImageFiles(files)
  }

  const resetDragState = () => {
    dragDepthRef.current = 0
    setIsDragActive(false)
  }

  const handleComposerPaste = async (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const files = getTransferredFiles(event.clipboardData)
    if (files.length === 0) {
      return
    }

    await appendImageFiles(files)
  }

  const handleComposerDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    if (!canInput) {
      return
    }
    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleComposerDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    if (!canInput) {
      resetDragState()
      return
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  const handleComposerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = canInput ? "copy" : "none"
  }

  const handleComposerDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    const files = getTransferredFiles(event.dataTransfer)
    resetDragState()

    if (!canInput || files.length === 0) {
      return
    }

    await appendImageFiles(files)
  }

  const canSubmit =
    canInput && (Boolean(input.trim()) || attachments.length > 0)

  // The sidebar names a conversation after its first user message; the header shows
  // the same, so the open conversation is identifiable without looking left.
  const sessionTitle = useMemo(() => {
    const firstUser = messages.find(
      (message) => message.role === "user" && message.content.trim(),
    )
    const text = (firstUser?.content ?? "").replace(/\s+/g, " ").trim()
    if (!text) {
      return t("navigation.chat")
    }
    return text.length > 44 ? `${text.slice(0, 44)}…` : text
  }, [messages, t])

  return (
    <div className="bg-background/95 flex h-full flex-col">
      <PageHeader
        title={sessionTitle}
        className={`transition-shadow ${
          hasScrolled ? "shadow-xs" : "shadow-none"
        }`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-8"
              aria-label={t("chat.showAssistantDetails")}
              title={t("chat.showAssistantDetails")}
            >
              <IconEye className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("chat.showAssistantDetails")}
            </DropdownMenuLabel>
            {assistantDetailVisibilityOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setAssistantDetailVisibility(option.value)}
              >
                <span className="flex-1">{option.label}</span>
                {assistantDetailVisibility === option.value && (
                  <IconCheck className="size-3.5 opacity-70" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTerminal}
          aria-pressed={terminalOpen}
          aria-label={t(
            terminalOpen
              ? "pages.terminal.hidePanel"
              : "pages.terminal.showPanel",
          )}
          title={t(
            terminalOpen
              ? "pages.terminal.hidePanel"
              : "pages.terminal.showPanel",
          )}
          className={cn(
            "size-8",
            terminalOpen
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <IconTerminal2 className="size-4" />
        </Button>
      </PageHeader>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto px-4 pt-3 pb-3 md:px-8 md:py-6 lg:px-24 xl:px-48"
      >
        <div className="mx-auto flex w-full max-w-250 flex-col gap-8 pb-2 md:pb-4">
          {messages.length === 0 && !isTyping && (
            <ChatEmptyState
              hasAvailableModels={hasAvailableModels}
              defaultModelName={defaultModelName}
              isConnected={isGatewayRunning}
            />
          )}

          {buildRenderItems(messages, assistantDetailVisibility).map((item) => {
            if (item.type === "activity") {
              return (
                <div key={item.key} className="flex w-full">
                  <ActivityFeed
                    messages={item.messages}
                    toolStats={toolStatsForTurn(messages, item.index)}
                    turnComplete={turnHasResult(messages, item.index)}
                  />
                </div>
              )
            }

            const msg = item.message
            const elapsedMs =
              item.type === "assistant" && (msg.usage || msg.stats)
                ? turnElapsedMs(
                    turnStartMessage(messages, item.index)?.timestamp,
                    msg.timestamp,
                  )
                : undefined

            return (
              <div
                key={msg.id}
                data-message-index={item.index}
                className={cn(
                  "flex w-full rounded-xl transition-shadow duration-500",
                  flashIndex === item.index &&
                    "ring-2 ring-primary/50 ring-offset-2 ring-offset-background",
                )}
              >
                {item.type === "assistant" ? (
                  <AssistantMessage
                    content={msg.content}
                    attachments={msg.attachments}
                    modelName={displayModelName(
                      msg.modelName,
                      selectableModels,
                    )}
                    timestamp={msg.timestamp}
                    usage={msg.usage}
                    elapsedMs={elapsedMs}
                    stats={msg.stats}
                    fileChanges={msg.fileChanges}
                  />
                ) : (
                  <UserMessage
                    content={msg.content}
                    attachments={msg.attachments}
                    timestamp={msg.timestamp}
                  />
                )}
              </div>
            )
          })}

          {isTyping && <TypingIndicator />}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={CHAT_IMAGE_ACCEPT}
        multiple
        className="hidden"
        onChange={handleImageSelection}
      />

      <ChatComposer
        input={input}
        attachments={attachments}
        onInputChange={setInput}
        onAddImages={handleAddImages}
        onPaste={handleComposerPaste}
        onDragEnter={handleComposerDragEnter}
        onDragLeave={handleComposerDragLeave}
        onDragOver={handleComposerDragOver}
        onDrop={handleComposerDrop}
        onRemoveAttachment={handleRemoveAttachment}
        onSend={handleSend}
        onContextDetail={() => {
          if (sendMessage({ content: "/context", attachments: [] })) {
            setInput("")
          }
        }}
        inputDisabledReason={inputDisabledReason}
        canSend={canSubmit}
        isDragActive={isDragActive}
        contextUsage={contextUsage}
        flushBottom={terminalOpen}
        modelSelector={
          hasAvailableModels ? (
            <ModelPicker
              value={selectedModelName}
              selectedModel={selectedModel}
              providerOptions={providerOptions}
              groups={[
                {
                  key: "apikey",
                  labelKey: "chat.modelGroup.apikey",
                  models: apiKeyModels,
                },
                {
                  key: "oauth",
                  labelKey: "chat.modelGroup.oauth",
                  models: oauthModels,
                },
                {
                  key: "local",
                  labelKey: "chat.modelGroup.local",
                  models: localModels,
                },
              ]}
              disabled={!canInput}
              onModelChange={setSessionModelPin}
              thinking={
                selectedModel?.supports_thinking
                  ? {
                      value: sessionThinkingLevel,
                      configuredLevel: selectedModel.thinking_level,
                      defaultLevel: selectedModel.thinking_default_level,
                      levels: selectedModel.thinking_levels,
                      onChange: setSessionThinkingLevel,
                    }
                  : null
              }
            />
          ) : undefined
        }
      />

      <TerminalDock />
    </div>
  )
}
