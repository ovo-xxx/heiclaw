import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// The effort levels this runtime knows how to send. The provider's own model list
// decides which of them a given model accepts; a level it cannot build a request for
// is left out of the picker instead of being offered as a dead choice.
export const THINKING_LEVELS = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "adaptive",
] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export function isThinkingLevel(
  value: string | undefined,
): value is ThinkingLevel {
  return (
    value !== undefined &&
    (THINKING_LEVELS as readonly string[]).includes(value)
  )
}

interface ThinkingSelectProps {
  /** The conversation's own choice; "" means it has not stated one. */
  value: string
  /** What the model entry configures, if anything. */
  configuredLevel?: string
  /** What the provider says it applies when a request states nothing. */
  defaultLevel?: string
  /** The ladder the provider accepts, already normalised. Empty means unknown. */
  levels?: string[]
  disabled?: boolean
  onValueChange: (level: string) => void
}

export function ThinkingSelect({
  value,
  configuredLevel,
  defaultLevel,
  levels,
  disabled = false,
  onValueChange,
}: ThinkingSelectProps) {
  const { t } = useTranslation()

  // The shown level is the one that would actually be used: the conversation's own
  // choice, then the model entry's, then the provider's stated default, then 关 -
  // the state in which the message states no effort at all.
  const current = firstKnown(value, configuredLevel, defaultLevel) ?? "off"

  return (
    <Select value={current} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={t("chat.thinking.label")}
        title={t("chat.thinking.label")}
        className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 w-[72px] shrink-0 bg-transparent px-2 text-[12px] shadow-none focus-visible:ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {thinkingOptions(levels).map((level) => (
          <SelectItem key={level} value={level}>
            {t(`chat.thinking.level.${level}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function firstKnown(
  ...candidates: (string | undefined)[]
): ThinkingLevel | undefined {
  for (const candidate of candidates) {
    if (isThinkingLevel(candidate)) {
      return candidate
    }
  }
  return undefined
}

// Off is always offered - it is how a turn says "do not think". The rest come from the
// provider; a provider that publishes no ladder keeps the common three, so the control
// still works where an endpoint simply does not describe its models.
function thinkingOptions(levels: string[] | undefined): string[] {
  const wanted = new Set<string>(["off"])
  for (const level of levels ?? []) {
    if (isThinkingLevel(level)) {
      wanted.add(level)
    }
  }
  if (wanted.size === 1) {
    wanted.add("low")
    wanted.add("medium")
    wanted.add("high")
  }
  return THINKING_LEVELS.filter((level) => wanted.has(level))
}
