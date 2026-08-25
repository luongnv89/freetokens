/* eslint-disable react-refresh/only-export-components -- shadcn primitives conventionally export their variants */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn/ui badge primitive (new-york), token-bridged like button.tsx.
// NOTE (#122): the listing's honesty tags keep their parity-pinned .badge
// markup (styles/python-parity.css) — this primitive serves NEW surfaces so
// future UI starts on the design system instead of hand-rolled spans.
const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-white",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
