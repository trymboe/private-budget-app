"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  token_hash: z.string().min(10).max(200),
  type: z.enum(["invite", "magiclink"]),
});

/** Use the one-time invitation token, then let the new person pick a password. */
export async function acceptInvite(formData: FormData) {
  const parsed = schema.safeParse({ token_hash: formData.get("token_hash"), type: formData.get("type") });
  if (!parsed.success) redirect("/login?error=link");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: parsed.data.type, token_hash: parsed.data.token_hash });
  if (error) redirect("/login?error=link");
  redirect("/settings/password?welcome=1");
}
