"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; action?: { label: string; onClick: () => void }; tone?: "default" | "error" };

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Quiet confirmation line at the bottom of the screen, with an optional Undo. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: Omit<Toast, "id">) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...t, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), t.action ? 5000 : 2800);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <ToastContext value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-8"
      >
        {toast ? (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-4 rounded-full py-2.5 pr-2.5 pl-5 text-sm shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] animate-fade-up",
              toast.tone === "error" ? "bg-brick text-paper" : "bg-ink text-paper",
            )}
          >
            <span className="min-w-0 truncate">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
                className="shrink-0 rounded-full px-3 py-1 font-medium text-paper underline-offset-4 hover:underline"
              >
                {toast.action.label}
              </button>
            ) : (
              <span className="w-2.5" />
            )}
          </div>
        ) : null}
      </div>
    </ToastContext>
  );
}
