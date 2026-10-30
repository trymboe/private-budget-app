import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncConnection } from "@/lib/banking/sync";
import { cronSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily background sync, invoked by Vercel Cron (see vercel.json). Vercel sends
// `Authorization: Bearer $CRON_SECRET`. Hobby plans run crons once a day with
// ±59 min precision and do not retry, so the job is idempotent and resumable:
// whatever it does not reach today, it reaches tomorrow.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUDGET_MS = 270_000;

function authorized(request: NextRequest) {
  const secret = cronSecret();
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const deadline = started + BUDGET_MS;
  const db = createAdminClient();
  const { data: connections, error } = await db
    .from("bank_connections")
    .select("id, user_id, last_synced_at")
    .eq("status", "active")
    .or(`rate_limited_until.is.null,rate_limited_until.lt.${new Date().toISOString()}`)
    // Least recently synced first, so a timeout never starves the same connection.
    .order("last_synced_at", { ascending: true, nullsFirst: true });
  if (error) {
    console.error("[cron] could not list connections", error.code);
    return NextResponse.json({ error: "List failed" }, { status: 500 });
  }

  const userIds = [...new Set(connections.map((c) => c.user_id as string))];
  const { data: profiles } = userIds.length
    ? await db.from("profiles").select("id, time_zone").in("id", userIds)
    : { data: [] as { id: string; time_zone: string }[] };
  const timeZones = new Map((profiles ?? []).map((p) => [p.id as string, p.time_zone as string]));

  const summary = { connections: connections.length, synced: 0, failed: 0, skipped: 0 };
  for (const c of connections) {
    if (Date.now() > deadline) {
      summary.skipped += 1;
      continue;
    }
    const results = await syncConnection({
      userId: c.user_id,
      connectionId: c.id,
      trigger: "scheduled",
      timeZone: timeZones.get(c.user_id) ?? "Europe/Oslo",
      deadline,
    });
    if (results.some((r) => !r.ok)) summary.failed += 1;
    else summary.synced += 1;
  }

  // Housekeeping: drop old, used or expired authorisation states.
  await db.from("bank_auth_requests").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());

  // Counts only: nothing financial is logged.
  console.info("[cron] sync finished", { ...summary, ms: Date.now() - started });
  return NextResponse.json(summary);
}
