import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK,
  terminalTheme,
} from "@/components/terminal/terminal-theme"
import i18n from "@/i18n"

export type TerminalTabStatus = "connecting" | "open" | "exited" | "failed"

export interface TerminalTabInfo {
  id: string
  /** 1-based number used for the default "Shell N" title. */
  number: number
  /** Title renamed by the user, wins over everything else. */
  customTitle: string
  status: TerminalTabStatus
  /** i18n key for the reason shown when status is exited or failed. */
  reasonKey: string
  /** Bumped by a retry so panes re-open a fresh xterm in the same slot. */
  epoch: number
}

export interface TerminalCapacity {
  active: number
  max: number
}

interface Session {
  info: TerminalTabInfo
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
  host: HTMLElement | null
  ws: WebSocket | null
  encoder: TextEncoder
  opened: boolean
  observer: ResizeObserver | null
  disposed: boolean
  hadHandshake: boolean
  frame: number
}

const terminalTeardownGraceMs = 1500
const terminalDefaultMaxTabs = 8
const tabCloseCode = 1000
const minFitWidth = 40
const minFitHeight = 24

export function terminalWebSocketUrl(rows: number, cols: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const params = new URLSearchParams({ rows: String(rows), cols: String(cols) })
  return `${protocol}//${window.location.host}/api/terminal/ws?${params.toString()}`
}

function tabLabel(info: TerminalTabInfo): string {
  // Stable by design: the shell's own OSC title changes with every cd, which
  // made the tabs read as paths. Only an explicit rename overrides the number.
  return (
    info.customTitle ||
    i18n.t("pages.terminal.tabName", { number: info.number })
  )
}

/**
 * Owns every browser terminal session, outside React, so a tab's PTY socket
 * survives the dock being hidden, a pane being re-split and the tab bar
 * re-rendering. Sockets are only torn down when a tab closes, when the last
 * view using the manager unmounts, or on a retry.
 */
class TerminalManager {
  private sessions = new Map<string, Session>()
  private order: string[] = []
  private snapshot: TerminalTabInfo[] = []
  private listeners = new Set<() => void>()
  private sequence = 0
  private mounts = 0
  private teardownTimer: number | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  label(id: string): string {
    const session = this.sessions.get(id)
    return session ? tabLabel(session.info) : ""
  }

  /** Repaints every live terminal with the palette matching the app theme. */
  applyTheme() {
    const theme = terminalTheme()
    for (const session of this.sessions.values()) {
      if (!session.disposed) {
        session.term.options.theme = theme
      }
    }
  }

  createTab(): string {
    this.sequence += 1
    const id = `term-${this.sequence}-${Math.random().toString(36).slice(2, 8)}`
    const term = new Terminal({
      cursorBlink: true,
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: TERMINAL_SCROLLBACK,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)

    const element = document.createElement("div")
    element.className = "h-full w-full"

    const session: Session = {
      info: {
        id,
        number: this.sequence,
        customTitle: "",
        status: "connecting",
        reasonKey: "pages.terminal.reasonConnecting",
        epoch: 0,
      },
      term,
      fit,
      element,
      host: null,
      ws: null,
      encoder: new TextEncoder(),
      opened: false,
      observer: null,
      disposed: false,
      hadHandshake: false,
      frame: 0,
    }

    term.onData((data) => this.writeStdin(session, data))
    term.onResize(({ rows, cols }) => this.sendResize(session, rows, cols))

    this.sessions.set(id, session)
    this.order.push(id)

    // The tab is still created when the client-side ceiling is reached, so the
    // user gets the reason in the pane instead of a button that does nothing.
    const localCapReached =
      this.order.filter(
        (item) => this.sessions.get(item)?.info.status !== "failed",
      ).length > this.maximumTabs()
    if (localCapReached) {
      this.mutate(session, {
        status: "failed",
        reasonKey: "pages.terminal.reasonCapped",
      })
    } else {
      this.publish()
      void this.connect(session)
    }

    return id
  }

  closeTab(id: string) {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }
    this.destroySession(session)
    this.order = this.order.filter((item) => item !== id)
    this.publish()
  }

  closeAll() {
    for (const id of [...this.order]) {
      const session = this.sessions.get(id)
      if (session) {
        this.destroySession(session)
      }
    }
    this.order = []
    this.publish()
  }

  renameTab(id: string, title: string) {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }
    this.mutate(session, { customTitle: title.trim() })
  }

  /** Point the keyboard at one shell - what the strip's underline promises. */
  focus(id: string) {
    const session = this.sessions.get(id)
    if (session && !session.disposed) {
      this.focusTab(session)
    }
  }

  /** Fresh PTY for an exited or failed tab: same slot, same id, new socket. */
  retryTab(id: string) {
    const session = this.sessions.get(id)
    if (!session || session.disposed) {
      return
    }

    this.closeSocket(session)
    session.term.dispose()
    session.element.replaceChildren()
    session.opened = false
    session.hadHandshake = false

    const term = new Terminal({
      cursorBlink: true,
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: TERMINAL_SCROLLBACK,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.onData((data) => this.writeStdin(session, data))
    term.onResize(({ rows, cols }) => this.sendResize(session, rows, cols))

    session.term = term
    session.fit = fit
    this.mutate(session, {
      status: "connecting",
      reasonKey: "pages.terminal.reasonConnecting",
      epoch: session.info.epoch + 1,
    })

    const host = session.host
    if (host?.isConnected) {
      this.openIn(session, host)
    }
    void this.connect(session)
  }

  /** A pane takes ownership of the tab's element for as long as it is mounted. */
  attach(id: string, host: HTMLElement) {
    const session = this.sessions.get(id)
    if (!session || session.disposed) {
      return
    }
    if (session.host && session.host !== host) {
      session.observer?.disconnect()
      session.observer = null
      session.element.remove()
    }
    session.host = host
    host.appendChild(session.element)

    if (!session.opened) {
      this.openIn(session, host)
      return
    }
    this.scheduleFit(session)
  }

  detach(id: string, host: HTMLElement) {
    const session = this.sessions.get(id)
    if (!session || session.host !== host) {
      return
    }
    session.observer?.disconnect()
    session.observer = null
    // The element keeps living in the manager, so the socket and the buffer are
    // untouched; only the pane stops hosting it.
    session.element.remove()
    session.host = null
  }

  /** Refcounted so a route change does not strand a PTY, and StrictMode's
   *  double mount does not kill a session that was just created. */
  retain() {
    this.mounts += 1
    if (this.teardownTimer !== null) {
      window.clearTimeout(this.teardownTimer)
      this.teardownTimer = null
    }
  }

  release() {
    this.mounts -= 1
    if (this.mounts > 0 || this.teardownTimer !== null) {
      return
    }
    this.teardownTimer = window.setTimeout(() => {
      this.teardownTimer = null
      if (this.mounts === 0) {
        this.closeAll()
      }
    }, terminalTeardownGraceMs)
  }

  private maximumTabs(): number {
    // Follow the server cap so the UI cannot offer more tabs than sockets.
    return lastCapacityMax
  }

  private openIn(session: Session, host: HTMLElement) {
    session.term.open(session.element)
    session.opened = true
    if (hasSize(host)) {
      this.fitNow(session)
    }
    const observer = new ResizeObserver(() => this.scheduleFit(session))
    observer.observe(host)
    session.observer = observer
    // Assigned, not added: a retry reuses this element and must not stack up
    // listeners.
    session.element.onmousedown = () => this.focusTab(session)
  }

  private focusTab(session: Session) {
    session.term.focus()
  }

  private scheduleFit(session: Session) {
    if (session.frame !== 0) {
      return
    }
    session.frame = window.requestAnimationFrame(() => {
      session.frame = 0
      this.fitNow(session)
    })
  }

  private fitNow(session: Session) {
    const host = session.host
    if (!host || !hasSize(host) || session.disposed || !session.opened) {
      return
    }
    try {
      session.fit.fit()
    } catch {
      // A detached or zero-size container cannot be measured; retry on resize.
    }
    // Repaint after a visibility or parent change, or the renderer keeps the
    // stale geometry of the hidden state.
    session.term.refresh(0, session.term.rows - 1)
  }

  private writeStdin(session: Session, data: string) {
    if (session.ws?.readyState === WebSocket.OPEN) {
      session.ws.send(session.encoder.encode(data))
    }
  }

  private sendResize(session: Session, rows: number, cols: number) {
    if (session.ws?.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: "resize", rows, cols }))
    }
  }

  private async connect(session: Session) {
    const capacity = await readCapacity()
    if (session.disposed) {
      return
    }
    if (capacity && capacity.active >= capacity.max) {
      this.mutate(session, {
        status: "failed",
        reasonKey: "pages.terminal.reasonCapped",
      })
      session.term.write(
        `\r\n\x1b[33mterminal sessions exhausted (max ${capacity.max})\x1b[0m\r\n`,
      )
      return
    }
    this.dial(session)
  }

  private dial(session: Session) {
    const ws = new WebSocket(
      terminalWebSocketUrl(session.term.rows, session.term.cols),
    )
    ws.binaryType = "arraybuffer"
    session.ws = ws

    ws.onopen = () => {
      if (session.disposed) {
        return
      }
      session.hadHandshake = true
      this.mutate(session, {
        status: "open",
        reasonKey: "pages.terminal.reasonConnected",
      })
      // The socket was dialled with the size known at that moment; tell the
      // shell the real one as soon as the pipe is open.
      this.sendResize(session, session.term.rows, session.term.cols)
      this.focusTab(session)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        session.term.write(new Uint8Array(event.data))
      } else {
        session.term.write(String(event.data))
      }
    }

    ws.onclose = () => {
      if (session.disposed || session.ws !== ws) {
        return
      }
      session.ws = null
      this.mutate(session, {
        status: session.hadHandshake ? "exited" : "failed",
        reasonKey: session.hadHandshake
          ? "pages.terminal.reasonExited"
          : "pages.terminal.reasonDisconnected",
      })
      void this.confirmCapped(session)
    }

    ws.onerror = () => {
      if (session.disposed || session.ws !== ws) {
        return
      }
      this.mutate(session, {
        status: "failed",
        reasonKey: "pages.terminal.reasonDisconnected",
      })
    }
  }

  /** The browser cannot read a failed handshake's status code, so the cap
   *  reason comes from the capacity endpoint instead. */
  private async confirmCapped(session: Session) {
    if (session.info.status !== "failed" || session.hadHandshake) {
      return
    }
    const capacity = await readCapacity()
    if (
      !session.disposed &&
      capacity &&
      capacity.active >= capacity.max &&
      session.info.status === "failed"
    ) {
      this.mutate(session, { reasonKey: "pages.terminal.reasonCapped" })
    }
  }

  private closeSocket(session: Session) {
    const ws = session.ws
    session.ws = null
    if (!ws) {
      return
    }
    ws.onopen = null
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close(tabCloseCode, "tab closed")
    }
  }

  private destroySession(session: Session) {
    // Socket first, then the renderer: the server turns a closed socket into a
    // killed process group, so nothing may keep the connection half-open.
    session.disposed = true
    this.closeSocket(session)
    session.observer?.disconnect()
    session.observer = null
    if (session.frame !== 0) {
      window.cancelAnimationFrame(session.frame)
      session.frame = 0
    }
    session.element.remove()
    session.host = null
    session.term.dispose()
    this.sessions.delete(session.info.id)
  }

  private mutate(session: Session, patch: Partial<TerminalTabInfo>) {
    session.info = { ...session.info, ...patch }
    this.publish()
  }

  private publish() {
    this.snapshot = this.order
      .map((id) => this.sessions.get(id)?.info)
      .filter((info): info is TerminalTabInfo => Boolean(info))
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function hasSize(host: HTMLElement): boolean {
  return host.clientWidth >= minFitWidth && host.clientHeight >= minFitHeight
}

let capacityCache: Promise<TerminalCapacity | null> | null = null
let capacityCacheAt = 0
let lastCapacityMax = terminalDefaultMaxTabs
const capacityCacheMs = 400

async function readCapacity(): Promise<TerminalCapacity | null> {
  const now = Date.now()
  if (capacityCache && now - capacityCacheAt < capacityCacheMs) {
    return capacityCache
  }
  capacityCacheAt = now
  capacityCache = fetch("/api/terminal/capacity", {
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        return null
      }
      const data = (await response.json()) as TerminalCapacity
      if (data.max > 0) {
        lastCapacityMax = data.max
      }
      return data
    })
    .catch(() => null)
  return capacityCache
}

export const terminalManager = new TerminalManager()

export function terminalTabDisplayName(info: TerminalTabInfo): string {
  return tabLabel(info)
}
