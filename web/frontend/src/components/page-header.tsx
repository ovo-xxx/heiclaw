import { IconMenu2 } from "@tabler/icons-react"
import type { ReactNode } from "react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  titleExtra?: ReactNode
  children?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  titleExtra,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("z-40 shrink-0 px-4 pt-2 sm:h-14 sm:px-6", className)}>
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {/* The trigger is the only way into the sidebar now that the app header is
              gone: on a phone it opens the drawer, on a desktop it collapses the rail. */}
          <SidebarTrigger className="border-border/60 bg-background text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border [&>svg]:size-5">
            <IconMenu2 />
          </SidebarTrigger>
          {/* The title keeps its own line on a phone: sharing one nowrap row with the
              action buttons squeezed 模型 into two stacked characters. */}
          <h2 className="text-foreground/90 shrink-0 text-xl font-medium tracking-tight whitespace-nowrap">
            {title}
          </h2>
          {titleExtra}
        </div>
        {children && (
          <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:overflow-visible sm:pb-0">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
