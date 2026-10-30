import { cloneElement, isValidElement } from "react";
import { cn } from "@/lib/utils";

/** Minimal asChild support: merges className and props onto the single child. */
export function Slot({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  if (!isValidElement<{ className?: string }>(children)) return null;
  return cloneElement(children, {
    ...props,
    ...children.props,
    className: cn(className, children.props.className),
  });
}
