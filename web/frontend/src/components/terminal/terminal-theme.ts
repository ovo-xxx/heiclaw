import type { ITheme } from "@xterm/xterm"

export const TERMINAL_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

export const TERMINAL_FONT_SIZE = 13

export const TERMINAL_SCROLLBACK = 8000

const darkTheme: ITheme = {
  background: "#09090b",
  foreground: "#d4d4d8",
  cursor: "#a1a1aa",
  cursorAccent: "#09090b",
  selectionBackground: "#3f3f46",
  selectionForeground: "#fafafa",
  black: "#3f3f46",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#71717a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
}

// Light palette keeps the ANSI *names* but darkens the values: the default
// white/black pair would be unreadable on a white background, so the "black"
// set becomes visible grey-black and "white" becomes a mid grey.
const lightTheme: ITheme = {
  background: "#ffffff",
  foreground: "#18181b",
  cursor: "#52525b",
  cursorAccent: "#ffffff",
  selectionBackground: "#d4d4d8",
  selectionForeground: "#18181b",
  black: "#52525b",
  red: "#b91c1c",
  green: "#15803d",
  yellow: "#a16207",
  blue: "#1d4ed8",
  magenta: "#86198f",
  cyan: "#0e7490",
  white: "#71717a",
  brightBlack: "#3f3f46",
  brightRed: "#dc2626",
  brightGreen: "#16a34a",
  brightYellow: "#ca8a04",
  brightBlue: "#2563eb",
  brightMagenta: "#a21caf",
  brightCyan: "#0891b2",
  brightWhite: "#18181b",
}

// The app's theme lives on the <html> class (see use-theme.ts, which keeps its
// own per-component state and is not a shared store), so the truth is the class.
export function terminalIsDark(): boolean {
  if (typeof document === "undefined") {
    return true
  }
  return document.documentElement.classList.contains("dark")
}

export function terminalTheme(): ITheme {
  return terminalIsDark() ? darkTheme : lightTheme
}

/** Calls onChange whenever the app flips between light and dark. */
export function subscribeTerminalTheme(onChange: (isDark: boolean) => void): () => void {
  if (typeof document === "undefined") {
    return () => {}
  }
  const observer = new MutationObserver(() => onChange(terminalIsDark()))
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  })
  return () => observer.disconnect()
}
