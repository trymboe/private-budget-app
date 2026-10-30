import {
  ArrowDownLeft,
  Baby,
  Bike,
  BookOpen,
  Briefcase,
  Car,
  Circle,
  CircleDashed,
  Coffee,
  Dog,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Lightbulb,
  Music,
  Palette,
  PiggyBank,
  Plane,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Ticket,
  TramFront,
  Utensils,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Curated icon set: restrained, line-only, one colour. Categories are identified
// by a small colour mark plus an optional icon, never by a rainbow of badges.
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  circle: Circle,
  "circle-dashed": CircleDashed,
  "shopping-basket": ShoppingBasket,
  coffee: Coffee,
  utensils: Utensils,
  wine: Wine,
  "tram-front": TramFront,
  car: Car,
  fuel: Fuel,
  bike: Bike,
  house: House,
  lightbulb: Lightbulb,
  sofa: Sofa,
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  smartphone: Smartphone,
  ticket: Ticket,
  music: Music,
  "book-open": BookOpen,
  palette: Palette,
  plane: Plane,
  "heart-pulse": HeartPulse,
  dumbbell: Dumbbell,
  scissors: Scissors,
  repeat: Repeat,
  gift: Gift,
  baby: Baby,
  dog: Dog,
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  "arrow-down-left": ArrowDownLeft,
  "piggy-bank": PiggyBank,
};

export const CATEGORY_COLORS = ["stone", "pine", "moss", "ochre", "clay", "brick", "plum", "slate", "sky", "sand"] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export function categoryColorVar(color: string) {
  return `var(--cat-${CATEGORY_COLORS.includes(color as CategoryColor) ? color : "stone"})`;
}

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = CATEGORY_ICONS[icon] ?? Circle;
  return <Icon className={cn("size-4", className)} aria-hidden strokeWidth={1.75} />;
}

/** Icon inside a softly tinted square: the one place a category's colour shows. */
export function CategoryMark({ icon, color, size = "md" }: { icon: string; color: string; size?: "sm" | "md" | "lg" }) {
  const c = categoryColorVar(color);
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        size === "sm" && "size-6 rounded-[5px]",
        size === "md" && "size-8",
        size === "lg" && "size-10 rounded-lg",
      )}
      style={{ color: c, backgroundColor: `color-mix(in oklab, ${c} 14%, transparent)` }}
    >
      <CategoryIcon icon={icon} className={size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4"} />
    </span>
  );
}
