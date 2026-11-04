import { IconTerminal2 } from "@tabler/icons-react"
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
import { ModelSelector } from "@/components/chat/model-selector"
import { ThinkingSelect } from "@/components/chat/thinking-select"
import { TypingIndicator } from "@/components/chat/typing-indicator"
import { UserMessage } from "@/components/chat/user-message"
import { PageHeader } from "@/components/page-header"
import { TerminalDock } from "@/components/terminal/terminal-dock"
import { useTerminalPanelToggle } from "@/components/terminal/use-terminal-panel"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

export function ChatPage() {
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

  const { messages, connectionState, isTyping, contextUsage, sendMessage } =
    usePicoChat()

  const { state: gwState } = useGateway()
  const isGatewayRunning = gwState === "running"
  const { open: terminalOpen, toggle: toggleTerminal } =
    useTerminalPanelToggle()

  const {
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

  return (
    <div className="bg-background/95 flex h-full flex-col">
      <PageHeader
        title={t("navigation.chat")}
        className={`transition-shadow ${
          hasScrolled ? "shadow-xs" : "shadow-none"
        }`}
        titleExtra={null}
      >
        <div className="border-border/60 hidden items-center gap-2 rounded-lg border px-3 py-1.5 sm:flex">
          <span className="text-muted-foreground text-sm">
            {t("chat.showAssistantDetails")}
          </span>
          <Select
            value={assistantDetailVisibility}
            onValueChange={(value) =>
              setAssistantDetailVisibility(value as AssistantDetailVisibility)
            }
          >
            <SelectTrigger
              size="sm"
              aria-label={t("chat.showAssistantDetails")}
              className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 min-w-[104px] bg-transparent shadow-none focus-visible:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {assistantDetailVisibilityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="secondary"
          size="sm"
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
            "h-9 gap-2",
            terminalOpen && "bg-muted text-foreground",
          )}
        >
          <IconTerminal2 className="size-4" />
          <span className="hidden sm:inline">
            {t(
              terminalOpen
                ? "pages.terminal.hidePanel"
                : "pages.terminal.showPanel",
            )}
          </span>
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
              <div key={msg.id} className="flex w-full">
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
            <ModelSelector
              value={selectedModelName}
              apiKeyModels={apiKeyModels}
              oauthModels={oauthModels}
              localModels={localModels}
              disabled={!canInput}
              onValueChange={setSessionModelPin}
            />
          ) : undefined
        }
        thinkingSelector={
          selectedModel?.supports_thinking ? (
            <ThinkingSelect
              value={sessionThinkingLevel}
              configuredLevel={selectedModel.thinking_level}
              defaultLevel={selectedModel.thinking_default_level}
              levels={selectedModel.thinking_levels}
              disabled={!canInput}
              onValueChange={setSessionThinkingLevel}
            />
          ) : undefined
        }
      />

      <TerminalDock />
    </div>
  )
}
