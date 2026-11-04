import {
  IconCheck,
  IconChevronDown,
} from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { ModelInfo, ModelProviderOption } from "@/api/models"
import { ProviderIcon } from "@/components/models/provider-icon"
import { getProviderCatalogEntry } from "@/components/models/provider-registry"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// One control for "which model and how hard should it think", the way Qoder's composer
// does it: the trigger names the model and its effort, and the panel lists the models
// by their identifier with the effort ladder for the one selected.

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

export interface ThinkingPickerProps {
  /** The conversation's own choice; "" means it has not stated one. */
  value: string
  configuredLevel?: string
  defaultLevel?: string
  levels?: string[]
  onChange: (level: string) => void
}

interface ModelGroup {
  key: string
  labelKey: string
  models: ModelInfo[]
}

interface ModelPickerProps {
  /** The model this conversation uses: one of the listed aliases. */
  value: string
  groups: ModelGroup[]
  /** The entry behind `value`, when the list still has it. */
  selectedModel?: ModelInfo
  /** The provider catalog, so each row can wear the provider's own logo. */
  providerOptions?: ModelProviderOption[]
  disabled?: boolean
  onModelChange: (modelName: string) => void
  /** Absent when the model does not reason or nothing is selected. */
  thinking: ThinkingPickerProps | null
}

function ProviderBadge({
  provider,
  providerOptions,
}: {
  provider: string | undefined
  providerOptions?: ModelProviderOption[]
}) {
  const entry = getProviderCatalogEntry(provider, providerOptions)
  if (entry) {
    return <ProviderIcon provider={entry} />
  }
  return (
    <span className="border-border/60 bg-background flex size-4 shrink-0 items-center justify-center rounded-sm border text-[9px] font-semibold">
      {providerInitial(provider)}
    </span>
  )
}

function providerInitial(provider: string | undefined): string {
  const name = provider?.trim()
  return name ? name.charAt(0).toUpperCase() : "?"
}

/** What the effort actually resolves to: conversation, entry, provider default, then off. */
export function effectiveThinkingLevel(
  thinking: ThinkingPickerProps | null | undefined,
): ThinkingLevel {
  if (!thinking) {
    return "off"
  }
  return (
    firstKnown(
      thinking.value,
      thinking.configuredLevel,
      thinking.defaultLevel,
    ) ?? "off"
  )
}

export function ModelPicker({
  value,
  groups,
  selectedModel,
  providerOptions,
  disabled = false,
  onModelChange,
  thinking,
}: ModelPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const level = effectiveThinkingLevel(thinking)
  const label = selectedModel?.model_name ?? value

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("chat.modelLabel")}
          className={cn(
            "text-muted-foreground hover:bg-muted/60 hover:text-foreground flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 rounded-lg px-2 text-xs transition-colors",
            disabled && "pointer-events-none opacity-60",
          )}
        >
          {selectedModel && (
            <ProviderBadge
              provider={selectedModel.provider}
              providerOptions={providerOptions}
            />
          )}
          <span className="text-foreground/85 max-w-[130px] truncate font-medium">
            {label || t("chat.noModel")}
          </span>
          {thinking && (
            <span className="text-muted-foreground/70 shrink-0 text-[11px]">
              {t(`chat.thinking.level.${level}`)}
            </span>
          )}
          <IconChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-80 p-1.5"
      >
        <div className="max-h-64 overflow-y-auto">
          {groups.map((group) =>
            group.models.length === 0 ? null : (
              <div key={group.key} className="mb-1 last:mb-0">
                <div className="text-muted-foreground/60 px-2 py-1 text-[10px] font-medium uppercase">
                  {t(group.labelKey)}
                </div>
                {group.models.map((model) => {
                  const selected = model.model_name === value
                  return (
                    <button
                      key={model.index}
                      type="button"
                      onClick={() => {
                        onModelChange(model.model_name)
                        setOpen(false)
                      }}
                      className={cn(
                        "hover:bg-accent/70 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                        selected && "bg-accent/60",
                      )}
                    >
                      <ProviderBadge
                        provider={model.provider}
                        providerOptions={providerOptions}
                      />
                      <span className="text-foreground/90 min-w-0 flex-1 truncate text-xs">
                        {model.model_name}
                      </span>
                      {/* The alias is the user's name for it; the identifier is what the
                          provider actually bills, and the two often differ. */}
                      <span className="text-muted-foreground/60 max-w-[45%] shrink-0 truncate font-mono text-[10px]">
                        {model.model}
                      </span>
                      {selected && (
                        <IconCheck className="text-foreground/70 size-3.5 shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            ),
          )}
        </div>

        {thinking && (
          <>
            <div className="border-border/60 my-1 border-t" />
            <div className="px-2 pb-1">
              <div className="text-muted-foreground/60 py-1 text-[10px] font-medium uppercase">
                {t("chat.thinking.label")}
              </div>
              <div className="flex flex-wrap gap-1">
                {thinkingOptions(thinking.levels).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => thinking.onChange(option)}
                    aria-pressed={option === level}
                    className={cn(
                      "h-6 rounded-md px-2 text-[11px] transition-colors",
                      option === level
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    {t(`chat.thinking.level.${option}`)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
