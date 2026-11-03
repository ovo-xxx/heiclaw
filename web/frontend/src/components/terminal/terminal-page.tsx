import { IconPlug, IconRefresh } from "@tabler/icons-react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TerminalStatus = "connecting" | "open" | "closed"

function terminalWebSocketUrl(rows: number, cols: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const params = new URLSearchParams({ rows: String(rows), cols: String(cols) })
  return `${protocol}//${window.location.host}/api/terminal/ws?${params.toString()}`
}

export function TerminalPage() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TerminalStatus>("connecting")
  const [sessionNonce, setSessionNonce] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    setStatus("connecting")
    const ws = new WebSocket(terminalWebSocketUrl(term.rows, term.cols))
    ws.binaryType = "arraybuffer"

    let disposed = false
    ws.onopen = () => setStatus("open")
    ws.onclose = () => {
      if (!disposed) {
        setStatus("closed")
      }
    }
    ws.onerror = () => {
      if (!disposed) {
        setStatus("closed")
      }
    }
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data))
      } else {
        term.write(String(event.data))
      }
    }

    const encoder = new TextEncoder()
    const dataSubscription = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data))
      }
    })
    const resizeSubscription = term.onResize(({ rows, cols }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", rows, cols }))
      }
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      dataSubscription.dispose()
      resizeSubscription.dispose()
      ws.close()
      term.dispose()
    }
  }, [sessionNonce])

  const statusLabel =
    status === "open"
      ? t("pages.terminal.statusConnected")
      : status === "connecting"
        ? t("pages.terminal.statusConnecting")
        : t("pages.terminal.statusClosed")

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("navigation.terminal")}
        children={
          <>
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <IconPlug
                className={cn(
                  "size-4",
                  status === "open"
                    ? "text-green-500"
                    : status === "connecting"
                      ? "text-amber-500"
                      : "text-muted-foreground",
                )}
              />
              {statusLabel}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSessionNonce((value) => value + 1)}
            >
              <IconRefresh className="size-4" />
              {t("pages.terminal.newSession")}
            </Button>
          </>
        }
      />

      <div className="bg-background flex flex-1 flex-col overflow-hidden p-4 sm:p-6">
        <div
          ref={containerRef}
          className="border-border/60 bg-zinc-950 min-h-0 flex-1 overflow-hidden rounded-xl border px-3 py-2"
        />
      </div>
    </div>
  )
}
