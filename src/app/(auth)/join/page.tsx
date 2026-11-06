import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import { acceptInvite } from "./actions";
import { JoinButton } from "./join-button";

export const metadata: Metadata = { title: "Join" };

// The invitation link opens this page. Chat apps fetch links to build previews,
// so nothing happens on GET: the one-time token is only used when the invited
// person presses the button.
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash: tokenHash, type } = await searchParams;
  const valid = !!tokenHash && (type === "invite" || type === "magiclink");
  return (
    <>
      <h1 className="font-display text-2xl leading-none tracking-tight">You’re invited.</h1>
      {valid ? (
        <>
          <p className="mt-3 text-sm text-ink-2">
            Someone wants to share a budget with you in {APP_NAME}. You get your own login and your own private accounts, plus a shared
            space for what you pay for together. Nobody sees your private accounts but you.
          </p>
          <form action={acceptInvite} className="mt-10">
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <JoinButton />
          </form>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-2">This link is incomplete. Ask for a new invitation link.</p>
      )}
    </>
  );
}
