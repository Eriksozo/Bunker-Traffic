"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer items-center after:absolute after:-inset-1 rounded-(--ds-radius-pill) border border-(--ds-stroke-strong) shadow-none transition-[background-color,border-color] duration-(--ds-dur-quick) ease-(--ds-ease-out) outline-none hover:not-disabled:data-[state=unchecked]:border-(--ds-ink-faint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--ds-focus) disabled:cursor-not-allowed disabled:opacity-(--ds-opacity-disabled) data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-[state=checked]:border-(--ds-accent) data-[state=checked]:bg-(--ds-accent) data-[state=unchecked]:bg-(--ds-fill-selected)",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full ring-0 transition-transform duration-(--ds-dur-select) ease-(--ds-ease-firm) group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 data-[state=unchecked]:translate-x-0.5 group-data-[size=default]/switch:data-[state=checked]:translate-x-[18px] group-data-[size=sm]/switch:data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-(--ds-on-accent) data-[state=unchecked]:bg-(--ds-ink-soft)"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
