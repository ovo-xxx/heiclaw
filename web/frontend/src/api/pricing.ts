import { launcherFetch } from "@/api/http"

// The price table is organised per provider; the numbers are what the user can edit,
// the currency and the peak rule come from the backend.

export interface PricingRates {
  input_per_mtok: number
  cache_read_per_mtok: number
  output_per_mtok: number
}

export interface PricingModel {
  model: string
  builtin: PricingRates
  custom?: PricingRates
  source?: string
  peak: boolean
}

export interface PricingProvider {
  provider: string
  currency: string
  models: PricingModel[]
}

export async function getPricing(): Promise<PricingProvider[]> {
  const res = await launcherFetch("/api/pricing")
  if (!res.ok) {
    throw new Error(`Failed to load pricing: ${res.status}`)
  }
  const body = (await res.json()) as { providers?: PricingProvider[] }
  return body.providers ?? []
}

export async function updateProviderPricing(
  provider: string,
  models: Record<string, PricingRates>,
): Promise<void> {
  const res = await launcherFetch(`/api/pricing/${encodeURIComponent(provider)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `Failed to save pricing: ${res.status}`)
  }
}
