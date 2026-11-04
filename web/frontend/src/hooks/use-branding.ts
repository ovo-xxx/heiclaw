import { useEffect, useState } from "react"

export interface Branding {
  name: string
  logoUrl: string
}

const DEFAULT_BRANDING: Branding = {
  name: "PicoClaw",
  logoUrl: "/logo_with_text.png",
}

// One fetch per page session: the panel asks for the brand in the sidebar, the speaker
// label and the tab title, and the answer only changes when the deployment restarts.
let brandingPromise: Promise<Branding> | null = null

function loadBranding(): Promise<Branding> {
  brandingPromise ??= fetch("/api/branding")
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { name?: string; logo_url?: string } | null) => ({
      name: body?.name?.trim() || DEFAULT_BRANDING.name,
      logoUrl: body?.logo_url || DEFAULT_BRANDING.logoUrl,
    }))
    .catch(() => DEFAULT_BRANDING)
  return brandingPromise
}

export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING)

  useEffect(() => {
    let active = true
    void loadBranding().then((next) => {
      if (!active) {
        return
      }
      setBranding(next)
      document.title = next.name
    })
    return () => {
      active = false
    }
  }, [])

  return branding
}
