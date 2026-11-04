import { IconArrowRight } from "@tabler/icons-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatTokenCount } from "@/features/chat/turn-stats"
import type { ContextUsage } from "@/store/chat"

interface ContextUsageRingProps {
  usage: ContextUsage
  onDetailClick?: () => void
}

export function ContextUsageRing({
  usage,
  onDetailClick,
}: ContextUsageRingProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const detailTimer = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
      if (detailTimer.current) clearTimeout(detailTimer.current)
    },
    [],
  )

  const percent = Math.min(usage.used_percent, 100)
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference
  const barPercent = Math.min(percent, 100)

  const handleDetail = () => {
    if (cooldown || !onDetailClick) {
      return
    }
    setCooldown(true)
    onDetailClick()
    setOpen(false)
    detailTimer.current = setTimeout(() => setCooldown(false), 1000)
  }

  // Desktop: hover to open, and leave closes after a short grace so crossing the
  // gap between the ring and the card does not flicker it away.
  const handleMouseEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }

  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  // Touch: preventDefault keeps the synthetic mouseenter from fighting the tap,
  // which would otherwise open and immediately close.
  const handleTouchStart = (event: React.TouchEvent) => {
    event.preventDefault()
    setOpen((value) => !value)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("chat.contextTitle")}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
          className="relative flex h-6 w-6 cursor-pointer items-center justify-center transition-opacity hover:opacity-70"
        >
          <svg className="h-6 w-6 -rotate-90" viewBox="0 0 20 20">
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              className="stroke-muted-foreground/30"
              strokeWidth="2"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span className="text-muted-foreground absolute text-[8px] font-medium tabular-nums">
            {percent}
          </span>
        </button>
      </PopoverTrigger>

      {/* The card is portalled. Rendered inside the composer it was clipped by the
          composer's own scroll box and painted under the input surface, so the
          bottom of it hid behind the box it described. */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[220px] rounded-xl p-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            {t("chat.contextTitle")}
          </span>
          <span className="text-xs font-medium tabular-nums">
            {formatTokenCount(usage.used_tokens)} /{" "}
            {formatTokenCount(usage.compress_at_tokens)}
          </span>
        </div>
        <div className="bg-muted mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-violet-500 transition-all"
            style={{ width: `${barPercent}%` }}
          />
        </div>

        <div className="mt-2 space-y-0.5">
          {usage.history_tokens != null && usage.history_tokens > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">
                {t("chat.turnStats.contextHistory")}
              </span>
              <span className="tabular-nums">
                {formatTokenCount(usage.history_tokens)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">
              {t("chat.contextCompressAt")}
            </span>
            <span className="tabular-nums">
              {formatTokenCount(usage.compress_at_tokens)}
            </span>
          </div>
          {usage.summarize_at_tokens != null &&
            usage.summarize_at_tokens > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">
                  {t("chat.contextSummarizeAt")}
                </span>
                <span className="tabular-nums">
                  {formatTokenCount(usage.summarize_at_tokens)}
                </span>
              </div>
            )}
        </div>

        <button
          type="button"
          onClick={handleDetail}
          disabled={cooldown}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-600 transition-opacity hover:opacity-70 disabled:opacity-40 dark:text-violet-400"
        >
          {t("chat.contextDetail")}
          <IconArrowRight className="h-3 w-3" />
        </button>
      </PopoverContent>
    </Popover>
  )
}
