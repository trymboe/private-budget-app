import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Spaces: every person has a personal space, and two people can share a "shared"
// space. Accounts, transactions, categories and budgets belong to one space.
// Which spaces you can see is decided by Row Level Security (membership); the
// cookie below only remembers which of your spaces you are looking at.

export const SPACE_COOKIE = "maate_space";

export type SpaceMember = { userId: string; name: string | null; isMe: boolean; role: "owner" | "member" };

export type Space = {
  id: string;
  kind: "personal" | "shared";
  name: string;
  members: SpaceMember[];
};

type Row = Record<string, unknown>;

/** The spaces the signed-in user belongs to: personal first, then shared. */
export const getSpaces = cache(async (): Promise<Space[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("spaces").select("id, kind, name, space_members ( user_id, role )").order("created_at");
  if (error) {
    console.error("[spaces] load failed", error.code);
    throw new Error("Could not load spaces.");
  }
  const memberIds = [...new Set(data.flatMap((s) => ((s.space_members as Row[]) ?? []).map((m) => m.user_id as string)))];
  const { data: profiles } = memberIds.length
    ? await supabase.from("profiles").select("id, display_name").in("id", memberIds)
    : { data: [] as Row[] };
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]));

  const spaces = data.map((s) => ({
    id: s.id as string,
    kind: s.kind as Space["kind"],
    name: s.name as string,
    members: ((s.space_members as Row[]) ?? []).map((m) => ({
      userId: m.user_id as string,
      name: names.get(m.user_id as string) ?? null,
      isMe: m.user_id === user.id,
      role: m.role as SpaceMember["role"],
    })),
  }));
  return spaces.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "personal" ? -1 : 1));
});

export async function getPersonalSpace(): Promise<Space> {
  const spaces = await getSpaces();
  const personal = spaces.find((s) => s.kind === "personal");
  if (!personal) throw new Error("Personal space missing.");
  return personal;
}

export async function getSharedSpace(): Promise<Space | null> {
  return (await getSpaces()).find((s) => s.kind === "shared") ?? null;
}

/** The space being viewed: the one in the cookie if you belong to it, else your personal space. */
export const getActiveSpace = cache(async (): Promise<Space> => {
  const [spaces, cookieStore] = await Promise.all([getSpaces(), cookies()]);
  const chosen = cookieStore.get(SPACE_COOKIE)?.value;
  return spaces.find((s) => s.id === chosen) ?? (await getPersonalSpace());
});

/** The other person in a shared space, if there is one. */
export function partnerOf(space: Space | null): SpaceMember | null {
  return space?.members.find((m) => !m.isMe) ?? null;
}

/** Short label for a space in the switcher. */
export function spaceLabel(space: Space): string {
  return space.kind === "personal" ? "Mine" : space.name;
}
