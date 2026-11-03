import { IconChevronRight } from "@tabler/icons-react"
import {
  IconAtom,
  IconChevronsDown,
  IconChevronsUp,
  IconKey,
  IconListDetails,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconTerminal2,
  IconTools,
} from "@tabler/icons-react"
import { Link, useRouterState } from "@tanstack/react-router"
import { useAtom } from "jotai"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { ConversationList } from "@/components/chat/conversation-list"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useSidebarChannels } from "@/hooks/use-sidebar-channels"
import { cn } from "@/lib/utils"
import { sidebarGroupsOpenAtom } from "@/store/sidebar"

interface NavItem {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  translateTitle?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
  isChannelsGroup?: boolean
}

const modelNavGroup: NavGroup = {
  label: "navigation.model_group",
  items: [
    {
      title: "navigation.models",
      url: "/models",
      icon: IconAtom,
      translateTitle: true,
    },
    {
      title: "navigation.credentials",
      url: "/credentials",
      icon: IconKey,
      translateTitle: true,
    },
  ],
}

const agentNavGroup: NavGroup = {
  label: "navigation.agent_group",
  items: [
    {
      title: "navigation.hub",
      url: "/agent/hub",
      icon: IconSearch,
      translateTitle: true,
    },
    {
      title: "navigation.skills",
      url: "/agent/skills",
      icon: IconSparkles,
      translateTitle: true,
    },
    {
      title: "navigation.tools",
      url: "/agent/tools",
      icon: IconTools,
      translateTitle: true,
    },
  ],
}

const servicesNavGroup: NavGroup = {
  label: "navigation.services",
  items: [
    {
      title: "navigation.config",
      url: "/config",
      icon: IconSettings,
      translateTitle: true,
    },
    {
      title: "navigation.logs",
      url: "/logs",
      icon: IconListDetails,
      translateTitle: true,
    },
    {
      title: "navigation.terminal",
      url: "/terminal",
      icon: IconTerminal2,
      translateTitle: true,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const routerState = useRouterState()
  const { i18n, t } = useTranslation()
  const { isMobile, setOpenMobile } = useSidebar()
  const [groupsOpen, setGroupsOpen] = useAtom(sidebarGroupsOpenAtom)
  const currentPath = routerState.location.pathname
  const {
    channelItems,
    hasMoreChannels,
    showAllChannels,
    toggleShowAllChannels,
  } = useSidebarChannels({
    language: (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase(),
    t,
  })

  const handleNavItemClick = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, setOpenMobile])

  const toggleGroup = React.useCallback(
    (label: string) => {
      setGroupsOpen((prev) => ({ ...prev, [label]: !(prev[label] ?? false) }))
    },
    [setGroupsOpen],
  )

  const navGroups: NavGroup[] = React.useMemo(
    () => [
      modelNavGroup,
      {
        label: "navigation.channels_group",
        items: channelItems.map((item) => ({
          title: item.title,
          url: item.url,
          icon: item.icon,
          translateTitle: false,
        })),
        isChannelsGroup: true,
      },
      agentNavGroup,
      servicesNavGroup,
    ],
    [channelItems],
  )

  const renderNavItem = (item: NavItem) => {
    const isActive =
      currentPath === item.url ||
      (item.url !== "/" && currentPath.startsWith(`${item.url}/`))

    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          onClick={handleNavItemClick}
          className={cn(
            "h-9 px-3",
            isActive
              ? "bg-accent/80 text-foreground font-medium"
              : "text-muted-foreground hover:bg-muted/60",
          )}
        >
          <Link to={item.url}>
            <item.icon
              className={cn("size-4", isActive ? "opacity-100" : "opacity-60")}
            />
            <span className={isActive ? "opacity-100" : "opacity-80"}>
              {item.translateTitle === false ? item.title : t(item.title)}
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <Sidebar
      {...props}
      className="bg-background border-r-border/20 border-r pt-3"
    >
      <ConversationList />

      {/* A single hairline divider: flush to the sidebar content box on both
          sides (w-full inside sidebar-inner, which sits left of the border-r),
          no horizontal inset, no extra vertical gap, no label. */}
      <div aria-hidden className="bg-border/60 h-px w-full shrink-0" />

      <div className="max-h-[45%] shrink-0 overflow-y-auto px-2 pb-2">
        {navGroups.map((group) => (
          <Collapsible
            key={group.label}
            open={groupsOpen[group.label] ?? false}
            onOpenChange={() => toggleGroup(group.label)}
            className="group/collapsible mb-1"
          >
            <SidebarGroup className="px-1 py-0">
              <SidebarGroupLabel asChild>
                <CollapsibleTrigger
                  data-tour={
                    group.label === "navigation.model_group"
                      ? "models-nav"
                      : undefined
                  }
                  className="hover:bg-muted/60 flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 transition-colors"
                >
                  <span>{t(group.label)}</span>
                  <IconChevronRight className="size-3.5 opacity-50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </CollapsibleTrigger>
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent className="pt-1">
                  <SidebarMenu>
                    {group.items.map((item) => renderNavItem(item))}
                    {group.isChannelsGroup && hasMoreChannels && (
                      <SidebarMenuItem key="channels-more-toggle">
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
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </div>
      <SidebarRail />
    </Sidebar>
  )
}
