import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  type ModelInfo,
  type ModelProviderOption,
  getModels,
} from "@/api/models"

interface UseChatModelsOptions {
  isConnected: boolean
}

function isLocalModel(model: ModelInfo): boolean {
  const isLocalHostBase = Boolean(
    model.api_base?.includes("localhost") ||
    model.api_base?.includes("127.0.0.1"),
  )

  return (
    model.auth_method === "local" || (!model.auth_method && isLocalHostBase)
  )
}

/**
 * The model catalogue the chat picker offers, plus the agent's default. Changing
 * the default belongs to the models admin page; the chat page pins a model to one
 * conversation instead, so this hook no longer writes global config.
 */
export function useChatModels({ isConnected }: UseChatModelsOptions) {
  const [modelList, setModelList] = useState<ModelInfo[]>([])
  const [providerOptions, setProviderOptions] = useState<ModelProviderOption[]>([])
  const [defaultModelName, setDefaultModelName] = useState("")
  const loadModelsRequestIdRef = useRef(0)

  const loadModels = useCallback(async () => {
    try {
      const requestId = ++loadModelsRequestIdRef.current
      const data = await getModels()
      if (requestId !== loadModelsRequestIdRef.current) return
      setModelList(data.models)
      setProviderOptions(data.provider_options ?? [])
      setDefaultModelName(data.default_model.trim())
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => {
    const timerId = setTimeout(() => {
      void loadModels()
    }, 0)

    return () => clearTimeout(timerId)
  }, [isConnected, loadModels])

  const defaultSelectableModels = useMemo(() => {
    const modelsByAlias = new Map<string, ModelInfo[]>()
    for (const model of modelList) {
      const entries = modelsByAlias.get(model.model_name) ?? []
      entries.push(model)
      modelsByAlias.set(model.model_name, entries)
    }
    return [...modelsByAlias.values()].flatMap((entries) =>
      entries.every(
        (model) =>
          model.default_model_allowed !== false &&
          model.is_virtual !== true &&
          model.status !== "unconfigured",
      )
        ? [entries.find((model) => model.available) ?? entries[0]]
        : [],
    )
  }, [modelList])

  const hasAvailableModels = useMemo(
    () => defaultSelectableModels.some((m) => m.available),
    [defaultSelectableModels],
  )

  const oauthModels = useMemo(
    () =>
      defaultSelectableModels.filter(
        (m) => m.available && m.auth_method === "oauth",
      ),
    [defaultSelectableModels],
  )

  const localModels = useMemo(
    () => defaultSelectableModels.filter((m) => m.available && isLocalModel(m)),
    [defaultSelectableModels],
  )

  const apiKeyModels = useMemo(
    () =>
      defaultSelectableModels.filter(
        (m) => m.available && m.auth_method !== "oauth" && !isLocalModel(m),
      ),
    [defaultSelectableModels],
  )

  return {
    providerOptions,
    defaultModelName,
    hasAvailableModels,
    apiKeyModels,
    oauthModels,
    localModels,
  }
}
