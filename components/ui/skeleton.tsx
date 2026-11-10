import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-[ds-breathe_var(--ds-dur-breathe)_var(--ds-ease-in-out)_infinite_alternate] rounded-(--ds-radius-xs) bg-(--ds-fill-hover) motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
