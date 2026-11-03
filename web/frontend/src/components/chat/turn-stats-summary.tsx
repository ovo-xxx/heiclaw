import { IconChevronDown, IconGauge } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { TurnStats } from "@/api/sessions"
import { TurnStatsDetail } from "@/components/chat/turn-stats-detail"
import { TurnStatsRing } from "@/components/chat/turn-stats-ring"
import {
  formatDuration,
  formatTokenCount,
  turnDurationMs,
  turnTotalTokens,
} from "@/features/chat/turn-stats"
import { cn } from "@/lib/utils"
import type { TurnUsage } from "@/store/chat"

interface TurnStatsSummaryProps {
  stats?: TurnStats
  usage?: TurnUsage
  elapsedMs?: number
  modelName?: string
}

export function TurnStatsSummary({
  stats,
  usage,
  elapsedMs,
  modelName,
}: TurnStatsSummaryProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)

  const durationMs = turnDurationMs(stats, elapsedMs)
  const totalTokens = turnTotalTokens(stats, usage)
  const context = stats?.context_usage

  const parts: string[] = []
  if (totalTokens > 0) {
    parts.push(
      t("chat.turnStats.tokensValue", { count: formatTokenCount(totalTokens) }),
    )
  }
  if (durationMs !== undefined) {
    parts.push(formatDuration(durationMs))
  }
  if (parts.length === 0 && !context) {
    return null
  }

  const summaryLine = parts.join(" · ")

  // Sessions recorded before turn_stats existed only have the numbers the
  // message itself carries, so there is nothing to expand.
  if (!stats) {
    return (
      <div className="text-muted-foreground/50 mt-1 flex items-center gap-1.5 px-1 text-[11px]">
        <IconGauge className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate tabular-nums">{summaryLine}</span>
      </div>
    )
  }

  const toggleLabel = t(
    isOpen ? "chat.turnStats.collapse" : "chat.turnStats.expand",
  )

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="text-muted-foreground/55 hover:text-muted-foreground/80 flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11px] transition-colors"
      >
        <IconGauge className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate tabular-nums">{summaryLine}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1.5">
          {context && (
            <>
              <TurnStatsRing percent={context.used_percent} />
              <span className="tabular-nums">{context.used_percent}%</span>
            </>
          )}
          <IconChevronDown
            className={cn(
              "size-3 opacity-0 transition-all duration-200 group-hover:opacity-70",
              isOpen && "rotate-180 opacity-70",
            )}
          />
        </span>
      </button>
      {isOpen && <TurnStatsDetail stats={stats} modelName={modelName} />}
    </div>
  )
}
