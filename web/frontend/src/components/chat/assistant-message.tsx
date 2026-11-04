import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconDownload,
  IconFileText,
} from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useBranding } from "@/hooks/use-branding"

import type { TurnStats } from "@/api/sessions"
import { FileDiff } from "@/components/chat/file-diff"
import { MarkdownBody } from "@/components/chat/markdown-body"
import { TurnStatsSummary } from "@/components/chat/turn-stats-summary"
import { Button } from "@/components/ui/button"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"
import { formatMessageTime } from "@/hooks/use-pico-chat"
import { cn } from "@/lib/utils"
import type { ChatAttachment, TurnFileChange, TurnUsage } from "@/store/chat"

interface AssistantMessageProps {
  content: string
  attachments?: ChatAttachment[]
  modelName?: string
  timestamp?: string | number
  usage?: TurnUsage
  stats?: TurnStats
  elapsedMs?: number
  fileChanges?: TurnFileChange[]
}

// The answer itself. What the turn did on the way to it - reasoning and tool calls -
// is collected into one ActivityFeed above, so this component has one shape left.
export function AssistantMessage({
  content,
  attachments = [],
  modelName,
  timestamp = "",
  usage,
  stats,
  elapsedMs,
  fileChanges = [],
}: AssistantMessageProps) {
  const { t } = useTranslation()
  const branding = useBranding()
  const { copy, isCopied } = useCopyToClipboard()
  const hasText = content.trim().length > 0
  const imageAttachments = attachments.filter(
    (attachment) => attachment.type === "image",
  )
  const fileAttachments = attachments.filter(
    (attachment) => attachment.type !== "image",
  )
  const [isChangesOpen, setIsChangesOpen] = useState(false)
  const changeStats = fileChanges.reduce(
    (acc, change) => ({
      additions: acc.additions + change.additions,
      deletions: acc.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 },
  )
  const formattedTimestamp =
    timestamp !== "" ? formatMessageTime(timestamp) : ""
  const copyMessageLabel = isCopied
    ? t("chat.copiedLabel")
    : t("chat.copyMessage")
  const trimmedModelName = modelName?.trim() ?? ""

  return (
    <div className="group flex w-full flex-col gap-1.5">
      <div className="text-muted-foreground/60 flex items-center justify-between gap-2 px-1 text-xs opacity-70">
        <div className="flex items-center gap-2">
          <span>{branding.name}</span>
          {trimmedModelName && (
            <>
              <span className="opacity-50">•</span>
              <span>{trimmedModelName}</span>
            </>
          )}
          {formattedTimestamp && (
            <>
              <span className="opacity-50">•</span>
              <span>{formattedTimestamp}</span>
            </>
          )}
        </div>
      </div>

      {hasText && (
        <div className="bg-card text-card-foreground border-border/60 relative overflow-hidden rounded-xl border">
          <MarkdownBody content={content} tone="answer" />

          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "bg-background/50 hover:bg-background/80 absolute top-2 right-2 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100",
            )}
            onClick={() => void copy(content)}
            aria-label={copyMessageLabel}
            title={copyMessageLabel}
          >
            {isCopied ? (
              <IconCheck className="h-4 w-4 text-green-500" />
            ) : (
              <IconCopy className="text-muted-foreground h-4 w-4" />
            )}
          </Button>
        </div>
      )}

      {hasText && (
        <TurnStatsSummary
          stats={stats}
          usage={usage}
          elapsedMs={elapsedMs}
          modelName={trimmedModelName || undefined}
        />
      )}

      {fileChanges.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          <div
            className="text-muted-foreground/60 hover:text-muted-foreground/80 border-border/30 bg-muted/20 flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors select-none"
            onClick={() => setIsChangesOpen(!isChangesOpen)}
          >
            <div className="flex items-center gap-1.5">
              <IconFileText className="size-3.5" />
              <span>{t("chat.changedFilesLabel")}</span>
              <span className="text-muted-foreground/45">
                {fileChanges.length}
              </span>
              <span className="text-muted-foreground/45">
                +{changeStats.additions} -{changeStats.deletions}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <IconChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  isChangesOpen ? "rotate-180" : "",
                )}
              />
            </div>
          </div>
          {isChangesOpen &&
            fileChanges.map((change) => (
              <FileDiff
                key={`${change.path}`}
                path={change.path}
                diff={change.diff}
                additions={change.additions}
                deletions={change.deletions}
                hunks={change.hunks}
                oldPath={change.oldPath}
                newPath={change.newPath}
                fileLang={change.fileLang}
                binary={change.binary}
              />
            ))}
        </div>
      )}

      {imageAttachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {imageAttachments.map((attachment, index) => (
            <a
              key={`${attachment.url}-${index}`}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              className="group/img border-border/50 bg-muted/30 hover:border-border/80 relative overflow-hidden rounded-xl border shadow-sm transition-colors"
            >
              <img
                src={attachment.url}
                alt={attachment.filename || "Attached image"}
                className="max-h-80 max-w-[280px] object-contain transition-transform duration-300 group-hover/img:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-black/0 transition-colors group-hover/img:bg-black/10 dark:group-hover/img:bg-black/20" />
            </a>
          ))}
        </div>
      )}

      {fileAttachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-3">
          {fileAttachments.map((attachment, index) => (
            <a
              key={`${attachment.url}-${index}`}
              href={attachment.url}
              download={attachment.filename}
              className="group/file border-border/60 bg-card flex w-fit max-w-sm min-w-[220px] items-center gap-3.5 rounded-xl border px-4 py-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-500/30 hover:shadow-sm dark:hover:border-violet-500/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-violet-400 ring-1 ring-violet-500/10 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/30">
                <IconFileText className="h-5 w-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col pr-1">
                <span className="text-foreground/90 truncate text-[14px] leading-tight font-medium transition-colors group-hover/file:text-violet-600 dark:group-hover/file:text-violet-400">
                  {attachment.filename || "Download file"}
                </span>
                <span className="text-muted-foreground/70 mt-1 text-[12px] font-medium">
                  {attachment.filename?.split(".").pop()?.toUpperCase() ||
                    "FILE"}
                </span>
              </div>
              <div className="bg-muted/60 text-muted-foreground/50 dark:bg-muted/20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 group-hover/file:bg-violet-400 group-hover/file:text-white group-hover/file:shadow-sm dark:group-hover/file:bg-violet-400">
                <IconDownload className="h-4 w-4 transition-transform duration-300 group-hover/file:-translate-y-[1px]" />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
