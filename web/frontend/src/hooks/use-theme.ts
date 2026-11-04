import { useCallback, useEffect, useState } from "react"

// "system" follows the OS and is the default; the two explicit choices pin the panel
// regardless of the OS setting, which is what a user expects from a theme preference.
export type ThemePreference = "system" | "light" | "dark"
export type Theme = "light" | "dark"

const THEME_STORAGE_KEY = "theme"

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system"
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system"
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function useTheme() {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(getStoredPreference)
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(getStoredPreference()),
  )

  useEffect(() => {
    const next = resolveTheme(preference)
    applyTheme(next)
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, preference)

    if (preference !== "system") {
      return
    }
    // Follow the OS while the preference is "system", so the panel flips with it
    // instead of waiting for the next reload.
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const resolved = systemTheme()
      applyTheme(resolved)
      setTheme(resolved)
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [preference])

  const setThemePreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setPreferenceState((prev) => {
      const current = resolveTheme(prev)
      return current === "dark" ? "light" : "dark"
    })
  }, [])

  return { theme, preference, setThemePreference, toggleTheme }
}

// Shared theme signal for components that don't own the toggle: watches the
// `dark` class on <html> so any toggler (settings menu, login page) is picked
// up reactively, instead of each caller holding its own useState copy that
// never syncs.
export function useHtmlTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(getStoredPreference()))

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light")
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return theme
}
