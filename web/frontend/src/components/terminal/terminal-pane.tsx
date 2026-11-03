import { IconPlayerPlay, IconTerminal2 } from "@tabler/icons-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import { terminalManager } from "@/components/terminal/terminal-manager"
import { useTerminalTabs } from "@/components/terminal/use-terminal-tabs"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TerminalPaneProps {
  tabId: string | null
  className?: string
  onRequestNewTab?: () => void
  onPointerDown?: () => void
}

export function TerminalPane({
  tabId,
  className,
  onRequestNewTab,
  onPointerDown,
}: TerminalPaneProps) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const tabs = useTerminalTabs()
  const tab = tabs.find((item) => item.id === tabId) ?? null
  const epoch = tab?.epoch ?? 0

  useEffect(() => {
    const host = hostRef.current
    if (!host || !tabId) {
      return
    }
    terminalManager.attach(tabId, host)
    return () => {
      terminalManager.detach(tabId, host)
    }
  }, [tabId, epoch])

  if (!tabId || !tab) {
    return (
      <div
        className={cn(
          "border-border bg-card text-foreground/70 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 border border-dashed p-4 text-center text-xs",
          className,
        )}
      >
        <IconTerminal2 className="size-5 opacity-60" />
        <span>{t("pages.terminal.emptyPane")}</span>
        {onRequestNewTab && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onRequestNewTab}
          >
            {t("pages.terminal.newTab")}
          </Button>
        )}
      </div>
    )
  }

  const broken = tab.status === "exited" || tab.status === "failed"

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
    >
      <div
        ref={hostRef}
        className="terminal-xterm border-border bg-card min-h-0 flex-1 overflow-hidden border"
      />
      {tab.status === "connecting" && !broken && (
        <div className="text-foreground/70 pointer-events-none absolute inset-x-0 bottom-1 px-3 text-[11px]">
          {t("pages.terminal.statusConnecting")}
        </div>
      )}
      {broken && (
        <div className="bg-card border-border text-foreground/85 absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5 text-[11px]">
          <span className="flex-1 truncate">{t(tab.reasonKey)}</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => terminalManager.retryTab(tab.id)}
          >
            <IconPlayerPlay className="size-3" />
            {t("pages.terminal.retry")}
          </Button>
        </div>
      )}
    </div>
  )
}
