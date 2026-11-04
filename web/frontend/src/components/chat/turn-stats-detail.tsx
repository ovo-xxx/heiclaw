import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import type { TurnLLMCallStat, TurnStats } from "@/api/sessions"
import {
  CostBreakdown,
  TurnCostBreakdown,
} from "@/components/chat/cost-breakdown"
import { TurnStatsRing } from "@/components/chat/turn-stats-ring"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  callOutputRate,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokenCount,
  formatTokenExact,
  formatTokenRate,
  turnCacheHitPercent,
  turnCostText,
  turnOutputRate,
} from "@/features/chat/turn-stats"
import { cn } from "@/lib/utils"

interface TurnStatsDetailProps {
  stats: TurnStats
  modelName?: string
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground/55 flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
      {children}
    </div>
  )
}

function StatCell({
  label,
  value,
  className,
  title,
  hint,
}: {
  label: string
  value: string
  className?: string
  title?: string
  hint?: ReactNode
}) {
  const cell = (
    <div className="inline-flex min-w-0 cursor-help items-baseline gap-1">
      <span className="text-muted-foreground/55 min-w-0 truncate text-[10px]">
        {label}
      </span>
      <span
        className={cn(
          "text-muted-foreground/85 shrink-0 text-[11px] tabular-nums",
          className,
        )}
        title={hint ? undefined : title}
      >
        {value}
      </span>
    </div>
  )

  if (!hint) {
    return cell
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-[340px] text-[11px]">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

// Counts are shown abbreviated and carry the exact number on hover, the way the
// rest of the panel reads token totals at a glance.
function TokenCell({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <StatCell
      label={label}
      value={formatTokenCount(value)}
      title={formatTokenExact(value)}
      className={className}
    />
  )
}

function BadgePill({ children }: { children: ReactNode }) {
  return (
    <span className="bg-muted/70 text-muted-foreground/80 rounded px-1.5 py-0.5 text-[10px]">
      {children}
    </span>
  )
}

function LLMCallRow({
  call,
  position,
}: {
  call: TurnLLMCallStat
  position: number
}) {
  const { t } = useTranslation()
  const model = call.model ?? ""
  const provider = call.provider ?? ""
  const rate = callOutputRate(call)
  return (
    <div className="border-border/20 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t pt-1 first:border-t-0 first:pt-0">
      <span className="text-muted-foreground/50 shrink-0 font-mono text-[10px]">
        #{call.index || position}
      </span>
      <span className="text-muted-foreground/85 shrink-0 text-[11px] font-medium">
        {model || provider || t("chat.turnStats.unknownModel")}
      </span>
      {call.iteration !== undefined && (
        <span className="text-muted-foreground/45 shrink-0 text-[10px]">
          {t("chat.turnStats.callIteration", { n: call.iteration })}
        </span>
      )}
      <TokenCell
        label={t("chat.turnStats.input")}
        value={call.tokens.input_tokens}
      />
      <TokenCell
        label={t("chat.turnStats.output")}
        value={call.tokens.output_tokens}
      />
      <TokenCell
        label={t("chat.turnStats.total")}
        value={call.tokens.total_tokens}
      />
      <StatCell
        label={t("chat.turnStats.latency")}
        value={formatDuration(call.latency_ms)}
      />
      {call.time_to_first_token_ms !== undefined && (
        <StatCell
          label={t("chat.turnStats.firstToken")}
          value={formatDuration(call.time_to_first_token_ms)}
        />
      )}
      {rate !== undefined && (
        <StatCell
          label={t("chat.turnStats.outputRate")}
          value={formatTokenRate(rate)}
          className="text-foreground/80"
        />
      )}
      {call.finish_reason && (
        <StatCell
          label={t("chat.turnStats.finishReason")}
          value={call.finish_reason}
        />
      )}
      {call.tool_calls !== undefined && (
        <StatCell
          label={t("chat.turnStats.tools")}
          value={String(call.tool_calls)}
        />
      )}
      {call.content_chars !== undefined && (
        <TokenCell
          label={t("chat.turnStats.chars")}
          value={call.content_chars}
        />
      )}
      {call.cost && (
        <StatCell
          label={t("chat.turnStats.cost")}
          value={formatCost(call.cost.currency, call.cost.amount)}
          hint={<CostBreakdown cost={call.cost} tokens={call.tokens} />}
          className="text-foreground/80"
        />
      )}
      {call.cost && (
        <BadgePill>
          {t(
            call.cost.custom
              ? "chat.turnStats.customPriceShort"
              : call.cost.peak
                ? "chat.turnStats.peakBand"
                : "chat.turnStats.offPeakBand",
          )}
        </BadgePill>
      )}
      {call.retry_attempt !== undefined && (
        <BadgePill>
          {t("chat.turnStats.retry", { n: call.retry_attempt })}
        </BadgePill>
      )}
      {call.fallback_attempt !== undefined && (
        <BadgePill>
          {t("chat.turnStats.fallback", { n: call.fallback_attempt })}
        </BadgePill>
      )}
      {call.streamed_fallback === true && (
        <BadgePill>{t("chat.turnStats.streamFallback")}</BadgePill>
      )}
    </div>
  )
}

export function TurnStatsDetail({ stats, modelName }: TurnStatsDetailProps) {
  const { t } = useTranslation()
  const calls = stats.llm_calls ?? []
  const context = stats.context_usage
  const tokens = stats.tokens
  const turnRate = turnOutputRate(stats)
  const cost = turnCostText(stats)
  const cacheHit = turnCacheHitPercent(stats)
  const droppedCalls = stats.dropped_llm_call_count ?? 0
  const droppedTools = stats.dropped_tool_count ?? 0

  return (
    <div className="border-border/30 bg-muted/20 dark:bg-muted/10 flex flex-col gap-1 rounded-lg border px-2 py-1">
      {modelName && (
        <div className="flex min-w-0 items-baseline gap-2">
          <SectionTitle>{t("chat.turnStats.modelTitle")}</SectionTitle>
          <span className="text-muted-foreground/75 min-w-0 truncate font-mono text-[11px]">
            {modelName}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {stats.duration_ms !== undefined && (
          <StatCell
            label={t("chat.turnStats.duration")}
            value={formatDuration(stats.duration_ms)}
          />
        )}
        {stats.time_to_first_token_ms !== undefined && (
          <StatCell
            label={t("chat.turnStats.firstToken")}
            value={formatDuration(stats.time_to_first_token_ms)}
          />
        )}
        {stats.finish_reason && (
          <StatCell
            label={t("chat.turnStats.finishReason")}
            value={stats.finish_reason}
          />
        )}
        <StatCell
          label={t("chat.turnStats.calls")}
          value={String(stats.llm_call_count)}
        />
        <StatCell
          label={t("chat.turnStats.toolIterations")}
          value={String(stats.tool_iterations)}
        />
        {stats.stream_chunks !== undefined && (
          <TokenCell
            label={t("chat.turnStats.streamChunks")}
            value={stats.stream_chunks}
          />
        )}
        {turnRate !== undefined && (
          <StatCell
            label={t("chat.turnStats.outputRate")}
            value={formatTokenRate(turnRate)}
            title={t("chat.turnStats.outputRateHint")}
            className="text-foreground/80"
          />
        )}
      </div>

      <div>
        <SectionTitle>{t("chat.turnStats.tokensTitle")}</SectionTitle>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <TokenCell
            label={t("chat.turnStats.input")}
            value={tokens.input_tokens}
          />
          <TokenCell
            label={t("chat.turnStats.output")}
            value={tokens.output_tokens}
          />
          <TokenCell
            label={t("chat.turnStats.total")}
            value={tokens.total_tokens}
          />
          {tokens.cache_read_tokens !== undefined && (
            <TokenCell
              label={t("chat.turnStats.cacheRead")}
              value={tokens.cache_read_tokens}
            />
          )}
          {cacheHit !== undefined && (
            <StatCell
              label={t("chat.turnStats.cacheHitRate")}
              value={formatPercent(cacheHit)}
              title={t("chat.turnStats.cacheHitRateHint")}
              className="text-foreground/80"
            />
          )}
          {tokens.cache_creation_tokens !== undefined && (
            <TokenCell
              label={t("chat.turnStats.cacheWrite")}
              value={tokens.cache_creation_tokens}
            />
          )}
          {tokens.reasoning_tokens !== undefined && (
            <TokenCell
              label={t("chat.turnStats.reasoning")}
              value={tokens.reasoning_tokens}
            />
          )}
          {cost && stats.cost && (
            <StatCell
              label={t("chat.turnStats.cost")}
              value={cost}
              hint={<TurnCostBreakdown cost={stats.cost} calls={calls} />}
              className="text-foreground/80"
            />
          )}
        </div>
      </div>

      {calls.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionTitle>
            {t("chat.turnStats.callsTitle")}
            <span className="text-muted-foreground/45">{calls.length}</span>
          </SectionTitle>
          {calls.map((call, index) => (
            <LLMCallRow
              key={`${call.index}-${index}`}
              call={call}
              position={index + 1}
            />
          ))}
          {droppedCalls > 0 && (
            <div className="text-muted-foreground/55 px-1 text-[10px]">
              {t("chat.turnStats.droppedCalls", { count: droppedCalls })}
            </div>
          )}
        </div>
      )}

      {droppedTools > 0 && (
        <div className="text-muted-foreground/55 px-1 text-[10px]">
          {t("chat.turnStats.droppedTools", { count: droppedTools })}
        </div>
      )}

      {context && (
        <div>
          <SectionTitle>{t("chat.contextTitle")}</SectionTitle>
          <div className="mt-1 flex items-center gap-2">
            <TurnStatsRing percent={context.used_percent} />
            <div className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-violet-500"
                style={{ width: `${Math.min(context.used_percent, 100)}%` }}
              />
            </div>
            <span className="text-muted-foreground/75 shrink-0 text-[10px] tabular-nums">
              {context.used_percent}%
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <StatCell
              label={t("chat.turnStats.contextUsed")}
              value={`${formatTokenCount(context.used_tokens)} / ${formatTokenCount(context.total_tokens)}`}
              title={`${formatTokenExact(context.used_tokens)} / ${formatTokenExact(context.total_tokens)}`}
            />
            {context.history_tokens !== undefined && (
              <TokenCell
                label={t("chat.turnStats.contextHistory")}
                value={context.history_tokens}
              />
            )}
            <TokenCell
              label={t("chat.contextCompressAt")}
              value={context.compress_at_tokens}
            />
            {context.summarize_at_tokens !== undefined && (
              <TokenCell
                label={t("chat.contextSummarizeAt")}
                value={context.summarize_at_tokens}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
