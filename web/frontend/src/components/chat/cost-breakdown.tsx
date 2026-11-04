import { useTranslation } from "react-i18next"

import type {
  TurnCallCost,
  TurnCost,
  TurnLLMCallStat,
  TurnTokens,
} from "@/api/sessions"
import { formatCostExact } from "@/features/chat/turn-stats"

// The basis behind a money figure: which price row, which band, and the
// multiplication per token category. A cost that cannot be checked reads like a
// number the panel invented, so every amount in the UI carries this.
export function CostBreakdown({
  cost,
  tokens,
}: {
  cost: TurnCallCost
  tokens: TurnTokens
}) {
  const { t } = useTranslation()
  const rows = [
    {
      label: t("chat.turnStats.input"),
      count: tokens.input_tokens,
      rate: cost.input_rate,
      amount: cost.input,
    },
    {
      label: t("chat.turnStats.cacheRead"),
      count: tokens.cache_read_tokens ?? 0,
      rate: cost.cache_read_rate,
      amount: cost.cache_read,
    },
    {
      label: t("chat.turnStats.output"),
      count: tokens.output_tokens,
      rate: cost.output_rate,
      amount: cost.output,
    },
  ]

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {cost.table || t("chat.turnStats.cost")}
        </span>
        <span>
          {t(
            cost.peak
              ? "chat.turnStats.peakBand"
              : "chat.turnStats.offPeakBand",
          )}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="opacity-70">{row.label}</span>
            <span className="tabular-nums">
              {Math.round(row.count).toLocaleString()} ×{" "}
              {formatCostExact(cost.currency, row.rate)}
              {t("chat.turnStats.perMillion")} ={" "}
              {formatCostExact(cost.currency, row.amount)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t border-current/15 pt-1">
        <span>{t("chat.turnStats.total")}</span>
        <span className="font-medium tabular-nums">
          {formatCostExact(cost.currency, cost.amount)}
        </span>
      </div>

      {cost.custom ? (
        <div className="text-[10px] leading-snug opacity-55">
          {t("chat.turnStats.customPrice")}
        </div>
      ) : (
        cost.source && (
          <div className="text-[10px] leading-snug break-all opacity-55">
            {cost.source}
          </div>
        )
      )}
    </div>
  )
}

// The turn total is a sum of per-call amounts, each decided by the hour its own
// call ran in, so its basis is the list of calls rather than one multiplication.
export function TurnCostBreakdown({
  cost,
  calls,
}: {
  cost: TurnCost
  calls: TurnLLMCallStat[]
}) {
  const { t } = useTranslation()
  const priced = calls.filter((call) => call.cost)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {cost.table || t("chat.turnStats.cost")}
        </span>
        <span>
          {t("chat.turnStats.calls")} {cost.covered_calls}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {priced.map((call) => (
          <div
            key={call.index}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="opacity-70">
              #{call.index} {call.model ?? call.provider ?? ""}
            </span>
            <span className="tabular-nums">
              {formatCostExact(
                call.cost?.currency ?? cost.currency,
                call.cost?.amount ?? 0,
              )}
              <span className="opacity-60">
                {" "}
                ·{" "}
                {t(
                  call.cost?.peak
                    ? "chat.turnStats.peakBand"
                    : "chat.turnStats.offPeakBand",
                )}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t border-current/15 pt-1">
        <span>{t("chat.turnStats.total")}</span>
        <span className="font-medium tabular-nums">
          {formatCostExact(cost.currency, cost.amount)}
        </span>
      </div>

      {cost.uncounted_calls ? (
        <div className="text-[10px] leading-snug opacity-65">
          {t("chat.turnStats.uncountedCalls", { count: cost.uncounted_calls })}
        </div>
      ) : null}
    </div>
  )
}
