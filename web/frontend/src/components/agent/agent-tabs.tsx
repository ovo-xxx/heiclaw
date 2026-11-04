import { Link, useRouterState } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

// The agent area has three pages; they sit side by side as buttons in the page header
// because the sidebar no longer lists second-level entries.
const agentTabs = [
  { url: "/agent/hub", labelKey: "navigation.hub" },
  { url: "/agent/skills", labelKey: "navigation.skills" },
  { url: "/agent/tools", labelKey: "navigation.tools" },
] as const

export function AgentTabs() {
  const { t } = useTranslation()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <nav
      aria-label={t("navigation.agent_group")}
      className="bg-muted/50 flex items-center gap-0.5 rounded-lg p-0.5"
    >
      {agentTabs.map((tab) => {
        const isActive =
          pathname === tab.url || pathname.startsWith(`${tab.url}/`)
        return (
          <Link
            key={tab.url}
            to={tab.url}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-7 items-center rounded-md px-2.5 text-xs transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
