import {
  IconBrain,
  IconChevronDown,
  IconLoader2,
  IconTool,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import type { TurnToolStat } from "@/api/sessions"
import { MarkdownBody } from "@/components/chat/markdown-body"
import { MessageCodeBlock } from "@/components/chat/message-code-block"
import {
  type ActivityRow,
  buildActivityRows,
} from "@/features/chat/activity-stream"
import { toolActivity } from "@/features/chat/tool-labels"
import { formatToolDuration } from "@/features/chat/tool-summary"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/store/chat"

// Everything one turn did, in one stream: a line per thought or tool call, each
// opening on its own. The turn used to leave a card per block on the page, so eight
// actions meant eight headers to scan past.
export function ActivityFeed({
  messages,
  toolStats = [],
  turnComplete = false,
}: {
  messages: ChatMessage[]
  /** The turn's tool records, taken from its answer message. */
  toolStats?: TurnToolStat[]
  /** Whether the turn already produced its result message. */
  turnComplete?: boolean
}) {
  const { t } = useTranslation()
  const rows = useMemo(
    () => buildActivityRows(messages, toolStats),
    [messages, toolStats],
  )
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const [isCollapsed, setIsCollapsed] = useState(false)
  // One clock for the whole stream: a running row counts up once a second, and the
  // timer stops the moment the turn is no longer streaming.
  const now = useNow(!turnComplete)

  if (rows.length === 0) {
    return null
  }

  const toolCount = rows.filter((row) => row.kind === "tool").length
  const thoughtCount = rows.length - toolCount

  return (
    <div className="border-border/60 bg-card overflow-hidden rounded-xl border">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsCollapsed((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setIsCollapsed((value) => !value)
          }
        }}
        className="text-muted-foreground/70 hover:text-muted-foreground/90 flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors select-none"
      >
        <IconTool className="size-3.5" />
        <span>
          {toolCount > 0
            ? t("chat.activity.toolCount", { count: toolCount })
            : t("chat.activity.thoughtCount", { count: thoughtCount })}
        </span>
        {toolCount > 0 && thoughtCount > 0 && (
          <span className="text-muted-foreground/45">
            {t("chat.activity.thoughtCount", { count: thoughtCount })}
          </span>
        )}
        <IconChevronDown
          className={cn(
            "ml-auto size-3.5 opacity-50 transition-transform",
            isCollapsed && "rotate-180",
          )}
        />
      </div>

      {!isCollapsed && (
        <div className="border-border/20 divide-border/15 flex flex-col divide-y border-t">
          {rows.map((row) => (
            <ActivityRowLine
              key={row.id}
              row={row}
              now={now}
              turnComplete={turnComplete}
              open={openRows[row.id] ?? false}
              onToggle={() =>
                setOpenRows((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// One interval for the whole stream instead of one per row.
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) {
      return
    }
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [enabled])
  return now
}

function ActivityRowLine({
  row,
  now,
  turnComplete,
  open,
  onToggle,
}: {
  row: ActivityRow
  now: number
  turnComplete: boolean
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const isThought = row.kind === "thought"
  const activity = isThought ? null : toolActivity(row.fallbackLabel)
  const Icon = isThought ? IconBrain : (activity?.icon ?? IconTool)
  // A row with no record yet is still executing - but only while the turn streams, so
  // an aborted turn cannot leave a row counting forever.
  const running =
    !isThought &&
    !turnComplete &&
    row.durationMs === undefined &&
    row.ok === undefined &&
    row.startedAt !== undefined &&
    // A turn that was aborted publishes no result, so the row would tick forever;
    // ten minutes is far past any real tool and stops that silently.
    now - row.startedAt < 10 * 60 * 1000
  const elapsedMs = running
    ? Math.max(now - (row.startedAt ?? now), 0)
    : undefined
  const label = isThought
    ? t("chat.reasoningLabel")
    : activity?.labelKey
      ? t(activity.labelKey)
      : row.fallbackLabel

  return (
    <div className="group/row min-w-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onToggle()
          }
        }}
        className="hover:bg-muted/40 flex w-full cursor-pointer items-baseline gap-2 px-3 py-1.5 text-[12px] transition-colors"
      >
        {running ? (
          <IconLoader2 className="size-3.5 shrink-0 animate-spin self-center opacity-60" />
        ) : (
          <Icon
            className={cn(
              "size-3.5 shrink-0 self-center opacity-60",
              row.ok === false && "text-red-500/80",
            )}
          />
        )}
        <span className="text-foreground/80 shrink-0">{label}</span>
        {row.summary && (
          <span
            className={cn(
              "text-muted-foreground/70 min-w-0 flex-1 truncate",
              !isThought && "font-mono",
              open && "overflow-visible",
            )}
          >
            {row.summary}
          </span>
        )}
        {running && (
          <span className="text-muted-foreground/60 shrink-0 text-[11px]">
            {t("chat.activity.running")}
          </span>
        )}
        {row.ok === false && (
          <span className="shrink-0 text-[11px] text-red-500/80 dark:text-red-400/80">
            {t("chat.turnStats.toolFailed")}
          </span>
        )}
        {(running ? elapsedMs : row.durationMs) !== undefined && (
          <span className="text-muted-foreground/50 ml-auto shrink-0 tabular-nums">
            {formatToolDuration((running ? elapsedMs : row.durationMs) ?? 0)}
          </span>
        )}
        <IconChevronDown
          className={cn(
            "size-3 shrink-0 self-center opacity-0 transition-all group-hover/row:opacity-40",
            open && "rotate-180 opacity-40",
          )}
        />
      </div>

      {open && (
        <div className="border-border/20 bg-background/40 px-3 py-2">
          {isThought ? (
            <MarkdownBody content={row.content ?? ""} tone="thought" />
          ) : (
            <ToolCallDetail row={row} />
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallDetail({ row }: { row: ActivityRow }) {
  const { t } = useTranslation()
  const name = row.toolCall?.function?.name?.trim() ?? ""
  const args = row.toolCall?.function?.arguments?.trim() ?? ""
  const explanation = row.explanation ?? ""

  return (
    <div className="flex flex-col gap-2">
      {explanation && (
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground/55 text-[11px] font-medium tracking-wide uppercase">
            {t("chat.toolCallExplanationLabel")}
          </div>
          <MarkdownBody content={explanation} tone="note" />
        </div>
      )}

      {(name || args) && (
        <div className="flex flex-col gap-1">
          <div className="text-muted-foreground/55 text-[11px] font-medium tracking-wide uppercase">
            {t("chat.toolCallFunctionLabel")}
          </div>
          <div className="bg-background/55 border-border/25 flex flex-col gap-2 rounded-lg border px-3 py-2.5">
            {name && !args && (
              <div className="text-foreground/75 font-mono text-[12px] font-semibold">
                {name}
              </div>
            )}
            {args && (
              <MessageCodeBlock
                code={args}
                language="json"
                label={name || t("chat.toolCallArgumentsLabel")}
                className="my-0 shadow-none"
                bodyClassName="px-3 py-2 text-[12px] leading-relaxed"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
