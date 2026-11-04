import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// The effort levels the runtime understands. "xhigh" and "adaptive" exist in the
// backend but are left out here: they only mean something on the couple of
// providers that map them, and offering a choice a model cannot honour is worse
// than a shorter list.
export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value)
}

interface ThinkingSelectProps {
  /** "" means the model entry's own thinking_level still rules. */
  value: string
  /** The level the model entry configures, shown as the un-set state. */
  configuredLevel?: string
  disabled?: boolean
  onValueChange: (level: string) => void
}

export function ThinkingSelect({
  value,
  configuredLevel,
  disabled = false,
  onValueChange,
}: ThinkingSelectProps) {
  const { t } = useTranslation()

  return (
    <Select
      value={value || "__configured__"}
      onValueChange={(next) =>
        onValueChange(next === "__configured__" ? "" : next)
      }
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("chat.thinking.label")}
        title={t("chat.thinking.label")}
        className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 w-[92px] shrink-0 bg-transparent px-2 text-[12px] shadow-none focus-visible:ring-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {/* The un-set state is the model's own configured effort, not a guess: the
            name comes from the model entry, and nothing is sent while it is chosen. */}
        <SelectItem value="__configured__">
          {configuredLevel && isThinkingLevel(configuredLevel)
            ? t(`chat.thinking.level.${configuredLevel}`, {
                defaultValue: configuredLevel,
              })
            : t("chat.thinking.configuredFallback")}
        </SelectItem>
        {THINKING_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {t(`chat.thinking.level.${level}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
