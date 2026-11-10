import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Carregando"
      className={cn("size-(--ds-size-icon-s) animate-spin motion-reduce:animate-none motion-reduce:opacity-50", className)}
      {...props}
    />
  )
}

export { Spinner }
