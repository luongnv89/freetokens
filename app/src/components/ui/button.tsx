/* eslint-disable react-refresh/only-export-components -- shadcn primitives conventionally export their variants */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonChrome =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4";

// shadcn/ui button primitive (new-york), Tailwind v4 CSS-variable theme.
// Every color utility resolves through the token bridge in
// styles/tokens.css → Task 2.2 tokens; no shadcn default palette is used.
// NOTE (#124): the home listing composes toolbar chips and the filter-empty
// reset through `variant="unstyled"` so python-parity.css keeps painting
// ranked rows. Default variants (h-9, bg-primary, rounded-md, …) must never
// land on listing controls — they rewrite the visual contract. New surfaces
// (consent, copy confirmation) still use the token-bridged default /
// secondary / etc. variants.
const buttonVariants = cva("", {
  variants: {
    variant: {
      default: `${buttonChrome} bg-primary text-primary-foreground hover:bg-primary/90`,
      destructive: `${buttonChrome} bg-destructive text-primary-foreground hover:bg-destructive/90`,
      outline: `${buttonChrome} border border-border bg-background hover:bg-secondary`,
      secondary: `${buttonChrome} bg-secondary text-secondary-foreground hover:bg-secondary/80`,
      ghost: `${buttonChrome} hover:bg-secondary`,
      link: `${buttonChrome} text-primary underline-offset-4 hover:underline`,
      unstyled: "",
    },
    size: {
      default: "h-9 px-4 py-2",
      sm: "h-8 rounded-md px-3",
      lg: "h-10 rounded-md px-6",
      icon: "size-9",
      unstyled: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  // Unstyled must emit no size chrome either — default size is h-9 px-4.
  const resolvedSize = variant === "unstyled" ? "unstyled" : size;
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size: resolvedSize, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
