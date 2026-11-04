import type { ModelInfo } from "@/api/models"

// The transcript records the identifier the provider was called with
// ("deepseek-v4-pro"), while the picker offers the alias the user chose ("pro").
// Showing the recorded id makes a working switch look like it did nothing, so the
// name is mapped back to the alias the user actually picked.
export function displayModelName(
  recorded: string | undefined,
  models: ModelInfo[],
): string | undefined {
  const name = recorded?.trim()
  if (!name || models.length === 0) {
    return name || undefined
  }
  const lower = name.toLowerCase()
  const match = models.find(
    (model) =>
      model.model_name?.toLowerCase() === lower ||
      model.model?.toLowerCase() === lower,
  )
  return match ? match.model_name : name
}
