import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/banking/crypto";
import { getProvider } from "@/lib/banking/index";
import { describeBankError, type ProviderId } from "@/lib/banking/types";
import { createAdminClient } from "@/lib/supabase/admin";

// The bank (via Enable Banking) redirects the browser here after the user has
// approved access with BankID. We:
//   1. validate `state`: it must exist, be unexpired, unused, and belong to the
//      user who is signed in right now (prevents CSRF / session mix-ups);
//   2. exchange the one-time `code` for a session (server-to-server);
//   3. store the session encrypted, and the accounts (re-attaching existing ones
//      on reconnect so history and categories are kept).

export const dynamic = "force-dynamic";

function back(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url), { status: 303 });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const bankError = params.get("error");

  const user = await getUser();
  if (!user) return back(request, "/login?next=/settings/accounts");
  if (!state || state.length < 32 || state.length > 128) return back(request, "/settings/connect?error=state");

  const admin = createAdminClient();
  // Atomically consume the state: only the first callback with it proceeds.
  const { data: auth } = await admin
    .from("bank_auth_requests")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state)
    .eq("user_id", user.id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("provider, institution_name, institution_country, history_from, reconnect_connection_id")
    .maybeSingle();
  if (!auth) return back(request, "/settings/connect?error=state");
  if (bankError || !code) return back(request, "/settings/connect?error=cancelled");

  let session;
  const provider = getProvider(auth.provider as ProviderId);
  try {
    session = await provider.completeAuthorization(code);
  } catch (err) {
    console.error("[bank] session exchange failed", describeBankError(err));
    return back(request, "/settings/connect?error=exchange");
  }
  if (session.accounts.length === 0) return back(request, "/settings/connect?error=no_accounts");

  const connectionFields = {
    session_secret: encryptSecret(session.sessionId),
    status: "active" as const,
    consent_valid_until: session.validUntil,
    last_sync_error: null,
    rate_limited_until: null,
  };

  let connectionId: string;
  if (auth.reconnect_connection_id) {
    const { data, error } = await admin
      .from("bank_connections")
      .update(connectionFields)
      .eq("id", auth.reconnect_connection_id)
      .eq("user_id", user.id)
      .select("id")
      .single();
    if (error) return back(request, "/settings/connect?error=save");
    connectionId = data.id;
  } else {
    const { data, error } = await admin
      .from("bank_connections")
      .insert({
        user_id: user.id,
        provider: auth.provider,
        institution_name: auth.institution_name,
        institution_country: auth.institution_country,
        ...connectionFields,
      })
      .select("id")
      .single();
    if (error) return back(request, "/settings/connect?error=save");
    connectionId = data.id;
  }

  // Re-attach known accounts by their stable identity; add new ones.
  const newAccountIds: string[] = [];
  for (const a of session.accounts) {
    const { data: existing } = await admin
      .from("accounts")
      .select("id, initial_import_completed_at")
      .eq("user_id", user.id)
      .eq("provider", auth.provider)
      .eq("provider_identity", a.identity)
      .maybeSingle();
    if (existing) {
      await admin
        .from("accounts")
        .update({ connection_id: connectionId, provider_account_uid: a.uid, iban_masked: a.ibanMasked })
        .eq("id", existing.id)
        .eq("user_id", user.id);
      if (!existing.initial_import_completed_at) newAccountIds.push(existing.id);
    } else {
      const { data: created, error } = await admin
        .from("accounts")
        .insert({
          user_id: user.id,
          connection_id: connectionId,
          provider: auth.provider,
          provider_account_uid: a.uid,
          provider_identity: a.identity,
          name: a.name,
          iban_masked: a.ibanMasked,
          currency: a.currency,
          history_requested_from: auth.history_from,
          // Savings-like accounts are easy to exclude on the next screen.
          include_in_budget: !/spar|saving/i.test(a.name),
        })
        .select("id")
        .single();
      if (error) return back(request, "/settings/connect?error=save");
      newAccountIds.push(created.id);
    }
  }

  // Reconnect with nothing new to import: straight back to accounts, and the
  // next sync catches up from the last synced date.
  if (auth.reconnect_connection_id && newAccountIds.length === 0) {
    return back(request, `/settings/accounts?reconnected=${connectionId}`);
  }
  return back(request, `/settings/connect/accounts?connection=${connectionId}`);
}
