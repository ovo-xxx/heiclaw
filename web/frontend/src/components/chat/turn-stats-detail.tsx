import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import type { TurnLLMCallStat, TurnStats } from "@/api/sessions"
import { TurnStatsRing } from "@/components/chat/turn-stats-ring"
import {
  formatCostUsd,
  formatDuration,
  formatTokenCount,
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
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-1.5">
      <span className="text-muted-foreground/55 min-w-0 truncate text-[10px]">
        {label}
      </span>
      <span
        className={cn(
          "text-muted-foreground/85 shrink-0 text-[11px] tabular-nums",
          className,
        )}
      >
        {value}
      </span>
    </div>
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
  const hasBadges =
    call.retry_attempt !== undefined ||
    call.fallback_attempt !== undefined ||
    call.streamed_fallback === true

  return (
    <div className="border-border/25 bg-background/45 dark:bg-background/20 rounded-lg border px-2 py-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="text-muted-foreground/50 shrink-0 font-mono text-[10px]">
          #{call.index || position}
        </span>
        <span className="text-muted-foreground/85 min-w-0 truncate text-[11px] font-medium">
          {model || provider || t("chat.turnStats.unknownModel")}
        </span>
        {model && provider && (
          <span className="text-muted-foreground/45 shrink-0 text-[10px]">
            {provider}
          </span>
        )}
        {call.iteration !== undefined && (
          <span className="text-muted-foreground/45 ml-auto shrink-0 text-[10px]">
            {t("chat.turnStats.callIteration", { n: call.iteration })}
          </span>
        )}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
        <StatCell
          label={t("chat.turnStats.input")}
          value={formatTokenCount(call.tokens.input_tokens)}
        />
        <StatCell
          label={t("chat.turnStats.output")}
          value={formatTokenCount(call.tokens.output_tokens)}
        />
        <StatCell
          label={t("chat.turnStats.total")}
          value={formatTokenCount(call.tokens.total_tokens)}
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
          <StatCell
            label={t("chat.turnStats.chars")}
            value={formatTokenCount(call.content_chars)}
          />
        )}
      </div>

      {hasBadges && (
        <div className="mt-1 flex flex-wrap gap-1">
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
      )}
    </div>
  )
}

export function TurnStatsDetail({ stats, modelName }: TurnStatsDetailProps) {
  const { t } = useTranslation()
  const calls = stats.llm_calls ?? []
  const tools = stats.tools ?? []
  const context = stats.context_usage
  const tokens = stats.tokens
  const cost = formatCostUsd(tokens.cost_usd ?? 0)
  const droppedCalls = stats.dropped_llm_call_count ?? 0
  const droppedTools = stats.dropped_tool_count ?? 0

  return (
    <div className="border-border/30 bg-muted/20 dark:bg-muted/10 flex flex-col gap-2.5 rounded-xl border px-2.5 py-2">
      {modelName && (
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <SectionTitle>{t("chat.turnStats.modelTitle")}</SectionTitle>
          <span className="text-muted-foreground/75 min-w-0 truncate font-mono text-[11px]">
            {modelName}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
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
          <StatCell
            label={t("chat.turnStats.streamChunks")}
            value={formatTokenCount(stats.stream_chunks)}
          />
        )}
      </div>

      <div>
        <SectionTitle>{t("chat.turnStats.tokensTitle")}</SectionTitle>
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
          <StatCell
            label={t("chat.turnStats.input")}
            value={formatTokenCount(tokens.input_tokens)}
          />
          <StatCell
            label={t("chat.turnStats.output")}
            value={formatTokenCount(tokens.output_tokens)}
          />
          <StatCell
            label={t("chat.turnStats.total")}
            value={formatTokenCount(tokens.total_tokens)}
          />
          {tokens.cache_read_tokens !== undefined && (
            <StatCell
              label={t("chat.turnStats.cacheRead")}
              value={formatTokenCount(tokens.cache_read_tokens)}
            />
          )}
          {tokens.cache_creation_tokens !== undefined && (
            <StatCell
              label={t("chat.turnStats.cacheWrite")}
              value={formatTokenCount(tokens.cache_creation_tokens)}
            />
          )}
          {tokens.reasoning_tokens !== undefined && (
            <StatCell
              label={t("chat.turnStats.reasoning")}
              value={formatTokenCount(tokens.reasoning_tokens)}
            />
          )}
          {cost && (
            <StatCell
              label={t("chat.turnStats.cost")}
              value={cost}
              className="text-foreground/80"
            />
          )}
        </div>
      </div>

      {calls.length > 0 && (
        <div className="flex flex-col gap-1.5">
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

      {tools.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <SectionTitle>
            {t("chat.turnStats.toolsTitle")}
            <span className="text-muted-foreground/45">{tools.length}</span>
          </SectionTitle>
          {tools.map((tool, index) => (
            <div
              key={`${tool.name}-${index}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  tool.ok ? "bg-emerald-500/70" : "bg-red-500/80",
                )}
              />
              <span className="text-muted-foreground/85 min-w-0 flex-1 truncate font-mono text-[11px]">
                {tool.name}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[10px]",
                  tool.ok
                    ? "text-muted-foreground/50"
                    : "text-red-500/80 dark:text-red-400/80",
                )}
              >
                {tool.ok
                  ? t("chat.turnStats.toolOk")
                  : t("chat.turnStats.toolFailed")}
              </span>
              <span className="text-muted-foreground/60 w-12 shrink-0 text-right text-[11px] tabular-nums">
                {formatDuration(tool.duration_ms)}
              </span>
            </div>
          ))}
          {droppedTools > 0 && (
            <div className="text-muted-foreground/55 px-1 pt-0.5 text-[10px]">
              {t("chat.turnStats.droppedTools", { count: droppedTools })}
            </div>
          )}
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
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
            <StatCell
              label={t("chat.turnStats.contextUsed")}
              value={`${formatTokenCount(context.used_tokens)} / ${formatTokenCount(context.total_tokens)}`}
            />
            {context.history_tokens !== undefined && (
              <StatCell
                label={t("chat.turnStats.contextHistory")}
                value={formatTokenCount(context.history_tokens)}
              />
            )}
            <StatCell
              label={t("chat.contextCompressAt")}
              value={formatTokenCount(context.compress_at_tokens)}
            />
            {context.summarize_at_tokens !== undefined && (
              <StatCell
                label={t("chat.contextSummarizeAt")}
                value={formatTokenCount(context.summarize_at_tokens)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
