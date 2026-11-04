import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { useSidebarChannels } from "@/hooks/use-sidebar-channels"
import {
  type NavSubItem,
  buildCategories,
  categoryForPath,
} from "@/lib/nav-categories"
import { cn } from "@/lib/utils"

// First level of the navigation: one tab per category, and the left rail under it
// lists that category's pages. The route decides the active tab, so a detail page
// keeps its category highlighted.
export function TopNav() {
  const { t, i18n } = useTranslation()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { channelItems } = useSidebarChannels({
    language: (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase(),
    t,
  })

  const categories = React.useMemo(
    () =>
      buildCategories(
        channelItems.map<NavSubItem>((item) => ({
          title: item.title,
          url: item.url,
          icon: item.icon,
          translateTitle: false,
        })),
      ),
    [channelItems],
  )
  const activeKey = categoryForPath(pathname) ?? "chat"

  return (
    <nav
      aria-label={t("navigation.sections")}
      className="flex min-w-0 items-center gap-1 overflow-x-auto"
    >
      {categories.map((category) => {
        const isActive = category.key === activeKey
        const Icon = category.icon
        return (
          <Link
            key={category.key}
            to={category.items[0]?.url ?? "/"}
            aria-current={isActive ? "page" : undefined}
            data-tour={category.key === "model" ? "models-nav" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "size-3.5",
                isActive ? "opacity-100" : "opacity-60",
              )}
            />
            <span className="whitespace-nowrap">{t(category.labelKey)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
