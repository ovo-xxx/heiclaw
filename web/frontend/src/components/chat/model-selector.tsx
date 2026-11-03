import { useTranslation } from "react-i18next"

import type { ModelInfo } from "@/api/models"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Select item meaning "no per-conversation pin; use the agent's default". */
export const FOLLOW_DEFAULT_MODEL = "__follow_default__"

interface ModelSelectorProps {
  /** Selected item: a model name, or FOLLOW_DEFAULT_MODEL. */
  value: string
  /** Shown when nothing is pinned, so the user sees what "默认" resolves to. */
  defaultModelName: string
  apiKeyModels: ModelInfo[]
  oauthModels: ModelInfo[]
  localModels: ModelInfo[]
  disabled?: boolean
  onValueChange: (modelName: string) => void
}

export function ModelSelector({
  value,
  defaultModelName,
  apiKeyModels,
  oauthModels,
  localModels,
  disabled = false,
  onValueChange,
}: ModelSelectorProps) {
  const { t } = useTranslation()
  const rawDefaultModel =
    value &&
    value !== FOLLOW_DEFAULT_MODEL &&
    ![...apiKeyModels, ...oauthModels, ...localModels].some(
      (model) => model.model_name === value,
    )
      ? value
      : ""

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 max-w-[160px] min-w-[80px] bg-transparent shadow-none focus-visible:ring-0 sm:max-w-[220px]"
      >
        <SelectValue placeholder={t("chat.noModel")} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={FOLLOW_DEFAULT_MODEL}>
          {t("chat.modelFollowDefault", { model: defaultModelName })}
        </SelectItem>
        {(apiKeyModels.length > 0 ||
          oauthModels.length > 0 ||
          localModels.length > 0 ||
          rawDefaultModel) && <SelectSeparator />}
        {rawDefaultModel && (
          <SelectItem value={rawDefaultModel}>{rawDefaultModel}</SelectItem>
        )}
        {rawDefaultModel &&
          (apiKeyModels.length > 0 ||
            oauthModels.length > 0 ||
            localModels.length > 0) && <SelectSeparator />}
        {apiKeyModels.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("chat.modelGroup.apikey")}</SelectLabel>
            {apiKeyModels.map((model) => (
              <SelectItem key={model.index} value={model.model_name}>
                {model.model_name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {apiKeyModels.length > 0 &&
          (oauthModels.length > 0 || localModels.length > 0) && (
            <SelectSeparator />
          )}

        {oauthModels.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("chat.modelGroup.oauth")}</SelectLabel>
            {oauthModels.map((model) => (
              <SelectItem key={model.index} value={model.model_name}>
                {model.model_name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {oauthModels.length > 0 &&
          (localModels.length > 0 || apiKeyModels.length > 0) && (
            <SelectSeparator />
          )}

        {localModels.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("chat.modelGroup.local")}</SelectLabel>
            {localModels.map((model) => (
              <SelectItem key={model.index} value={model.model_name}>
                {model.model_name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}
