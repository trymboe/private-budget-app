"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function JoinButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block disabled={pending}>
      {pending ? "Opening…" : "Accept and choose a password"}
    </Button>
  );
}
