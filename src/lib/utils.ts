import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about our custom type scale so `text-2xs` and `text-ink`
// are not treated as conflicting colour classes.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
