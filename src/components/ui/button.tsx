import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "./slot";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper hover:bg-ink/90",
        accent: "bg-accent text-accent-ink hover:bg-accent/90",
        secondary: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-sunken/60",
        ghost: "text-ink hover:bg-sunken/70",
        quiet: "text-ink-2 hover:text-ink",
        danger: "bg-surface text-brick ring-1 ring-inset ring-line-strong hover:bg-brick-soft",
      },
      size: {
        sm: "h-9 rounded-md px-3 text-xs",
        md: "h-11 rounded-md px-4 text-sm",
        lg: "h-13 rounded-lg px-5 text-base",
        icon: "size-11 rounded-full",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, block, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}
