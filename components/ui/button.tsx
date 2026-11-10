import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/* Notch ActionButton/PressableStyle (ver .ds-btn em app/notch-ds.css): cápsula, passar o mouse clareia,
   pressionar encolhe 3 % e esmaece, foco violeta de 2 px, desabilitado a .45. O botão desabilitado
   continua recebendo o mouse, para o `title` com o motivo aparecer. Só tokens --ds-*; as classes das
   seções (CSS sem camada) vencem estes utilitários. */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-(--ds-radius-pill) border border-transparent font-(family-name:--ds-font-text) text-(length:--ds-font-body) leading-tight font-semibold whitespace-nowrap select-none [-webkit-tap-highlight-color:transparent] transition-[background-color,border-color,color,opacity,transform] duration-(--ds-dur-hover) ease-(--ds-ease-out) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(--ds-focus) active:not-disabled:not-aria-disabled:opacity-(--ds-opacity-pressed) active:not-disabled:not-aria-disabled:[transform:scale(var(--ds-press-scale))] disabled:cursor-not-allowed disabled:opacity-(--ds-opacity-disabled) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--ds-opacity-disabled) aria-invalid:border-(--ds-bad) [&.ds-btn]:h-auto [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-(--ds-accent) bg-[linear-gradient(var(--ds-fill-selected),transparent)] text-(--ds-on-accent) hover:not-disabled:bg-[linear-gradient(var(--ds-fill-selected),transparent),linear-gradient(var(--ds-fill-hover),transparent)]",
        destructive:
          "border-(--ds-bad-rim) bg-(--ds-bad-fill) text-(--ds-bad) hover:not-disabled:border-(--ds-bad) hover:not-disabled:bg-[color-mix(in_srgb,var(--ds-bad)_var(--ds-tint-hover),transparent)]",
        outline:
          "border-(--ds-stroke) bg-(--ds-fill) text-(--ds-ink) hover:not-disabled:border-(--ds-stroke-strong) hover:not-disabled:bg-(--ds-fill-hover) aria-pressed:border-(--ds-stroke-strong) aria-pressed:bg-(--ds-fill-selected)",
        secondary:
          "border-(--ds-stroke) bg-(--ds-fill) text-(--ds-ink) hover:not-disabled:border-(--ds-stroke-strong) hover:not-disabled:bg-(--ds-fill-hover)",
        ghost:
          "bg-transparent text-(--ds-ink-soft) hover:not-disabled:bg-(--ds-fill-hover) hover:not-disabled:text-(--ds-ink) aria-pressed:bg-(--ds-fill-selected) aria-pressed:text-(--ds-ink)",
        link: "rounded-(--ds-radius-xs) text-(--ds-accent) underline-offset-4 hover:underline",
      },
      size: {
        default: "h-(--ds-size-control) px-3.5 has-[>svg]:px-3",
        xs: "h-(--ds-size-hit-min) gap-1 px-2 text-(length:--ds-font-micro) has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-(--ds-size-control-sm) gap-1 px-2.5 text-(length:--ds-font-caption) has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-5 has-[>svg]:px-4",
        icon: "size-(--ds-size-control)",
        "icon-xs": "size-(--ds-size-hit-min) [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-(--ds-size-icon-button)",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
