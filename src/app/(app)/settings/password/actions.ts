"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error?: string; message?: string } | undefined;

export async function updatePassword(_: PasswordState, formData: FormData): Promise<PasswordState> {
  await requireUser();
  const parsed = z.string().min(10).max(128).safeParse(formData.get("password"));
  if (!parsed.success) return { error: "Use at least 10 characters." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: error.code === "same_password" ? "That is your current password." : "Could not update the password." };
  return { message: "Password updated." };
}
