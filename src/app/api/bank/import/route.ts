import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { syncAccount } from "@/lib/banking/sync";
import { getProfile } from "@/lib/data/queries";

// Historical import for one account, called by the account-selection screen
// once per selected account so progress can be shown account by account.
// Must happen soon after consent: many banks only allow long history fetches in
// the first hour after authorisation.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, message: "Not signed in." }, { status: 401 });
  const body = z.object({ accountId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });

  const profile = await getProfile();
  const result = await syncAccount({
    userId: user.id,
    accountId: body.data.accountId,
    trigger: "initial",
    timeZone: profile.timeZone,
    deadline: Date.now() + 240_000,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.code === "NOT_FOUND" ? 404 : 409 });
}
