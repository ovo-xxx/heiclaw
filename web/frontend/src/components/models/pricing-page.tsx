import { IconDeviceFloppy, IconLoader2, IconArrowBackUp } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  type PricingModel,
  type PricingProvider,
  type PricingRates,
  getPricing,
  updateProviderPricing,
} from "@/api/pricing"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type RateField = keyof PricingRates

const RATE_FIELDS: RateField[] = ["input_per_mtok", "cache_read_per_mtok", "output_per_mtok"]

const valueKey = (provider: string, model: string, field: RateField) =>
  `${provider}:${model}:${field}`

function formatRate(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

export function PricingPage() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<PricingProvider[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const next = await getPricing()
      const seeded: Record<string, string> = {}
      for (const provider of next) {
        for (const model of provider.models) {
          const rates = model.custom ?? model.builtin
          for (const field of RATE_FIELDS) {
            seeded[valueKey(provider.provider, model.model, field)] = formatRate(
              rates[field],
            )
          }
        }
      }
      setProviders(next)
      setValues(seeded)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (provider: PricingProvider) => {
    setSaving(provider.provider)
    setError("")
    try {
      // A row that matches the built-in numbers is not an override: sending nothing
      // for it both keeps the file clean and is how "恢复内置" is expressed.
      const models: Record<string, PricingRates> = {}
      for (const model of provider.models) {
        const rates = {} as PricingRates
        let differs = false
        for (const field of RATE_FIELDS) {
          const raw = values[valueKey(provider.provider, model.model, field)] ?? ""
          const parsed = raw.trim() === "" ? 0 : Number(raw)
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error(t("pages.pricing.invalidRate", { model: model.model }))
          }
          rates[field] = parsed
          if (parsed !== model.builtin[field]) {
            differs = true
          }
        }
        if (differs) {
          models[model.model] = rates
        }
      }
      await updateProviderPricing(provider.provider, models)
      toast.success(t("pages.pricing.saved"))
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      toast.error(message)
    } finally {
      setSaving(null)
    }
  }

  const resetRow = (provider: PricingProvider, model: PricingModel) => {
    setValues((prev) => {
      const next = { ...prev }
      for (const field of RATE_FIELDS) {
        next[valueKey(provider.provider, model.model, field)] = formatRate(
          model.builtin[field],
        )
      }
      return next
    })
  }

  const totalModels = useMemo(
    () => providers.reduce((sum, provider) => sum + provider.models.length, 0),
    [providers],
  )

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("pages.pricing.title")} />

      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pb-8 sm:px-6">
        <div className="w-full max-w-4xl space-y-4 pt-4">
          <p className="text-muted-foreground text-sm">
            {t("pages.pricing.subtitle")}
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <IconLoader2 className="text-muted-foreground size-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-destructive bg-destructive/10 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          ) : totalModels === 0 ? (
            <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-10 text-center text-sm">
              {t("pages.pricing.empty")}
            </div>
          ) : (
            providers.map((provider) => (
              <section
                key={provider.provider}
                className="bg-card border-border/60 overflow-hidden rounded-xl border"
              >
                <div className="border-border/60 flex items-center justify-between gap-3 border-b px-4 py-2.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className="text-sm font-medium">{provider.provider}</h2>
                    <span className="text-muted-foreground text-[11px]">
                      {t("pages.pricing.perMillion", { currency: provider.currency })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 gap-1.5"
                    disabled={saving === provider.provider}
                    onClick={() => void save(provider)}
                  >
                    {saving === provider.provider ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconDeviceFloppy className="size-3.5" />
                    )}
                    {t("pages.pricing.save")}
                  </Button>
                </div>

                <div className="text-muted-foreground/60 grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)_4rem] items-center gap-2 px-4 py-1.5 text-[10px] uppercase">
                  <span>{t("pages.pricing.model")}</span>
                  <span>{t("pages.pricing.input")}</span>
                  <span>{t("pages.pricing.cacheRead")}</span>
                  <span>{t("pages.pricing.output")}</span>
                  <span />
                </div>

                {provider.models.map((model) => (
                  <div
                    key={model.model}
                    className="border-border/40 grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)_4rem] items-center gap-2 border-t px-4 py-1.5"
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-mono text-xs">{model.model}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-0.5 text-[10px]",
                          model.custom
                            ? "bg-primary/15 text-foreground"
                            : "bg-muted/60 text-muted-foreground/70",
                        )}
                      >
                        {t(
                          model.custom
                            ? "pages.pricing.custom"
                            : "pages.pricing.builtin",
                        )}
                      </span>
                      {model.peak && (
                        <span className="text-muted-foreground/60 shrink-0 text-[10px]">
                          {t("pages.pricing.peakHint")}
                        </span>
                      )}
                    </div>
                    {RATE_FIELDS.map((field) => (
                      <Input
                        key={field}
                        value={values[valueKey(provider.provider, model.model, field)] ?? ""}
                        onChange={(event) => {
                          const key = valueKey(provider.provider, model.model, field)
                          setValues((prev) => ({ ...prev, [key]: event.target.value }))
                        }}
                        placeholder={formatRate(model.builtin[field])}
                        type="number"
                        min={0}
                        step="0.001"
                        inputMode="decimal"
                        className="h-7 px-2 text-xs tabular-nums"
                      />
                    ))}
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="text-muted-foreground/70 hover:text-foreground"
                      aria-label={t("pages.pricing.reset")}
                      title={t("pages.pricing.reset")}
                      onClick={() => resetRow(provider, model)}
                    >
                      <IconArrowBackUp className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
