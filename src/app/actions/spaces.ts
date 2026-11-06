"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { getPersonalSpace, getSharedSpace, getSpaces, SPACE_COOKIE } from "@/lib/spaces";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

/** Switch which space (Mine or Shared) the app shows. */
export async function setActiveSpace(spaceId: string): Promise<ActionResult> {
  await requireUser();
  const spaces = await getSpaces();
  if (!spaces.some((s) => s.id === spaceId)) return { ok: false, error: "That space was not found." };
  const cookieStore = await cookies();
  cookieStore.set(SPACE_COOKIE, spaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Your own name, shown to your partner. */
export async function setDisplayName(name: string): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.string().trim().min(1, "Write a name.").max(80).safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name: parsed.data }).eq("id", user.id);
  if (error) return { ok: false, error: "Could not save your name." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Move one of your own accounts between your private space and the shared space.
 * Its transactions move with it; categories belong to a space, so they go back to
 * review in the new space.
 */
export async function moveAccount(accountId: string, to: "personal" | "shared"): Promise<ActionResult> {
  await requireUser();
  if (!z.uuid().safeParse(accountId).success) return { ok: false, error: "Invalid account." };
  const target = to === "personal" ? await getPersonalSpace() : await getSharedSpace();
  if (!target) return { ok: false, error: "Invite your partner first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_account_to_space", { p_account: accountId, p_space: target.id });
  if (error) {
    console.error("[spaces] move account failed", error.code);
    return { ok: false, error: "Could not move the account." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Write her name.").max(80),
  email: z.email("Write a valid email address.").max(254),
});

export type InviteState = { error?: string; link?: string; name?: string } | undefined;

/**
 * Invite your partner into a shared space. Works with public sign-ups switched off:
 * the account is created here with the secret key, and the one-time sign-in link
 * is shown to you to pass on (nothing is emailed). The link only signs in the new,
 * empty account; it is never made for someone who already uses Måte.
 */
export async function invitePartner(_: InviteState, formData: FormData): Promise<InviteState> {
  const user = await requireUser();
  const parsed = inviteSchema.safeParse({ name: formData.get("name"), email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the name and email." };
  const email = parsed.data.email.toLowerCase();
  if (email === user.email?.toLowerCase()) return { error: "That is your own email." };

  const admin = createAdminClient();

  // The shared space: reuse yours, or create it (with starter categories).
  let space = await getSharedSpace();
  let spaceId = space?.id ?? null;
  if (!spaceId) {
    const { data, error } = await admin.rpc("create_shared_space", { p_owner: user.id, p_name: "Shared" });
    if (error || !data) {
      console.error("[spaces] create shared space failed", error?.code);
      return { error: error?.code === "23505" ? "You are already in a shared space." : "Could not create the shared space." };
    }
    spaceId = data as string;
    space = null;
  }
  const existingPartner = space?.members.find((m) => !m.isMe) ?? null;

  const redirectBase = serverEnv().APP_URL;
  let link = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${redirectBase}/join` } });
  let createdNow = !link.error;

  if (link.error) {
    if (link.error.code !== "email_exists") {
      console.error("[spaces] invite failed", link.error.code);
      return { error: "Could not create the invitation. Try again." };
    }
    // Already registered: only allowed for your own pending invite (never signed in).
    const invitee = existingPartner ? (await admin.auth.admin.getUserById(existingPartner.userId)).data.user : null;
    if (!existingPartner || invitee?.email?.toLowerCase() !== email) {
      return {
        error: existingPartner
          ? `You already share with ${existingPartner.name ?? "someone"}.`
          : "That email already has a Måte account. Ask her to use a different email for now.",
      };
    }
    if (invitee.last_sign_in_at) return { error: `${existingPartner.name ?? "Your partner"} has already joined.` };
    link = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${redirectBase}/join` } });
    createdNow = false;
    if (link.error) {
      console.error("[spaces] new link failed", link.error.code);
      return { error: "Could not make a new link. Try again." };
    }
  } else if (existingPartner) {
    // A second person would not fit; undo the account we just created.
    await admin.auth.admin.deleteUser(link.data.user.id);
    return { error: `You already share with ${existingPartner.name ?? "someone"}.` };
  }

  const invitee = link.data.user;
  if (createdNow) {
    const { error } = await admin.from("space_members").insert({ space_id: spaceId, user_id: invitee.id, role: "member" });
    if (error) {
      console.error("[spaces] add member failed", error.code);
      await admin.auth.admin.deleteUser(invitee.id);
      return { error: "Could not add her to the shared space." };
    }
    await admin.from("profiles").update({ display_name: parsed.data.name }).eq("id", invitee.id);
  }

  // Opens a page with a button rather than signing in on GET, so a chat app's
  // link preview cannot use up the one-time token.
  const params = new URLSearchParams({
    token_hash: link.data.properties.hashed_token,
    type: link.data.properties.verification_type,
  });
  revalidatePath("/", "layout");
  return { link: `${redirectBase}/join?${params}`, name: parsed.data.name };
}
