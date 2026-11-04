import { IconChevronsDown, IconChevronsUp } from "@tabler/icons-react"
import { Link, useRouterState } from "@tanstack/react-router"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"

import { ConversationList } from "@/components/chat/conversation-list"
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useSidebarChannels } from "@/hooks/use-sidebar-channels"
import {
  type NavSubItem,
  buildCategories,
  categoryForPath,
} from "@/lib/nav-categories"
import { cn } from "@/lib/utils"

// Second level of the navigation: the pages of whichever category the top bar holds
// active. 对话 has no pages of its own - the conversation list is its second level.
export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const { t, i18n } = useTranslation()
  const { isMobile, setOpenMobile } = useSidebar()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const {
    channelItems,
    hasMoreChannels,
    showAllChannels,
    toggleShowAllChannels,
  } = useSidebarChannels({
    language: (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase(),
    t,
  })

  const categories = buildCategories(
    channelItems.map<NavSubItem>((item) => ({
      title: item.title,
      url: item.url,
      icon: item.icon,
      translateTitle: false,
    })),
  )
  const active = categories.find(
    (category) => category.key === categoryForPath(pathname),
  )
  const showPages = active !== undefined && active.items.length > 0

  return (
    <Sidebar
      {...props}
      className="bg-background border-r-border/20 border-r pt-3"
    >
      {active?.key === "chat" && <ConversationList />}

      {showPages && (
        <>
          {/* A single hairline divider: flush to the sidebar content box on both
              sides (w-full inside sidebar-inner, which sits left of the border-r),
              no horizontal inset, no extra vertical gap, no label. */}
          <div aria-hidden className="bg-border/60 h-px w-full shrink-0" />
          <div className="shrink-0 overflow-y-auto px-2 py-2">
            <SidebarGroup className="px-1 py-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  {active.items.map((item) => (
                    <NavRow
                      key={item.url}
                      item={item}
                      pathname={pathname}
                      label={
                        item.translateTitle === false
                          ? item.title
                          : t(item.title)
                      }
                      onNavigate={() => {
                        if (isMobile) {
                          setOpenMobile(false)
                        }
                      }}
                    />
                  ))}
                  {active.key === "channels" && hasMoreChannels && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={toggleShowAllChannels}
                        className="text-muted-foreground hover:bg-muted/60 h-9 px-3"
                      >
                        {showAllChannels ? (
                          <IconChevronsUp className="size-4 opacity-60" />
                        ) : (
                          <IconChevronsDown className="size-4 opacity-60" />
                        )}
                        <span className="opacity-80">
                          {showAllChannels
                            ? t("navigation.show_less_channels")
                            : t("navigation.show_more_channels")}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        </>
      )}
      <SidebarRail />
    </Sidebar>
  )
}

function NavRow({
  item,
  pathname,
  label,
  onNavigate,
}: {
  item: NavSubItem
  pathname: string
  label: string
  onNavigate: () => void
}) {
  const isActive = pathname === item.url || pathname.startsWith(`${item.url}/`)
  const Icon = item.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        onClick={onNavigate}
        className={cn(
          "h-9 px-3",
          isActive
            ? "bg-accent/80 text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/60",
        )}
      >
        <Link to={item.url}>
          <Icon
            className={cn("size-4", isActive ? "opacity-100" : "opacity-60")}
          />
          <span className={isActive ? "opacity-100" : "opacity-80"}>
            {label}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
