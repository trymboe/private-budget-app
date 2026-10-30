import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("block text-xs font-medium text-ink-2", className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-md bg-surface px-3.5 text-base text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full resize-none rounded-md bg-surface p-3.5 text-base text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent",
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs text-brick">
      {children}
    </p>
  );
}

export function SectionLabel({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("eyebrow", className)} {...props} />;
}
