"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { invitePartner, setDisplayName, type InviteState } from "@/app/actions/spaces";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function NameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex max-w-sm gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await setDisplayName(name);
          toast(r.ok ? { message: "Saved" } : { message: r.error, tone: "error" });
          router.refresh();
        });
      }}
    >
      <Input aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your first name" />
      <Button type="submit" variant="secondary" className="h-12" disabled={pending || name.trim() === "" || name === initial}>
        Save
      </Button>
    </form>
  );
}

export function InviteForm({ partnerName }: { partnerName: string | null }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(invitePartner, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.link) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-md bg-accent-soft px-3.5 py-3 text-sm">
          Send this link to {state.name ?? partnerName ?? "her"}, for example by text message. It works once and expires after a while (about an
          hour). Don’t open it yourself: it would sign you in as her.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={state.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="text-xs" />
          <Button
            variant="secondary"
            className="h-12 shrink-0"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="max-w-sm space-y-5">
      <div className="space-y-2">
        <Label htmlFor="invite-name">Her name</Label>
        <Input id="invite-name" name="name" required maxLength={80} defaultValue={partnerName ?? ""} autoComplete="off" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-email">Her email</Label>
        <Input id="invite-email" name="email" type="email" required maxLength={254} autoComplete="off" />
      </div>
      <FieldError>{state?.error}</FieldError>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating link…" : partnerName ? "Make a new link" : "Create invitation link"}
      </Button>
    </form>
  );
}
