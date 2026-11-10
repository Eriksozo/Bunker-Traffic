import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/* Notch pill (ver .ds-pill em app/notch-ds.css): cápsula de 11 px semibold com dígitos de largura fixa,
   tinta do tom sobre o fill do tom. default = violeta (identidade), secondary = neutro, destructive = coral,
   outline = rótulo de contexto com fio. */
const badgeVariants = cva(
  "inline-flex w-fit max-w-full shrink-0 items-center justify-center gap-[3px] overflow-hidden rounded-(--ds-radius-pill) border border-transparent px-2 py-0.5 font-(family-name:--ds-font-text) text-(length:--ds-font-pill) leading-[1.35] font-semibold whitespace-nowrap tabular-nums transition-[color,background-color,border-color] duration-(--ds-dur-hover) ease-(--ds-ease-out) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--ds-focus) aria-invalid:border-(--ds-bad-rim) [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "bg-(--ds-accent-fill) text-(--ds-accent) [a&]:hover:bg-[color-mix(in_srgb,var(--ds-accent)_var(--ds-tint-hover),transparent)]",
        secondary:
          "bg-(--ds-neutral-fill) text-(--ds-ink-pill) [a&]:hover:bg-(--ds-fill-hover)",
        destructive:
          "bg-(--ds-bad-fill) text-(--ds-bad) [a&]:hover:bg-[color-mix(in_srgb,var(--ds-bad)_var(--ds-tint-hover),transparent)]",
        outline:
          "border-(--ds-stroke-strong) bg-(--ds-tag-fill) text-(--ds-ink-soft) [a&]:hover:bg-(--ds-fill-hover) [a&]:hover:text-(--ds-ink)",
        ghost:
          "text-(--ds-ink-soft) [a&]:hover:bg-(--ds-fill-hover) [a&]:hover:text-(--ds-ink)",
        link: "text-(--ds-accent) underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
