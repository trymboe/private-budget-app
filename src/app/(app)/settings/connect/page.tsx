import type { Metadata } from "next";
import { ConnectForm, type InstitutionOption } from "@/components/bank/connect-form";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { availableProviders, getProvider, PREFERRED_INSTITUTION } from "@/lib/banking/index";
import { describeBankError } from "@/lib/banking/types";
import { getConnections, getToday } from "@/lib/data/queries";

export const metadata: Metadata = { title: "Connect a bank" };

const ERRORS: Record<string, string> = {
  state: "That bank response could not be verified (it may have expired). Please start again.",
  cancelled: "The bank authorisation was cancelled. Nothing was connected.",
  exchange: "The bank approved access, but we could not complete the connection. Please try again.",
  no_accounts: "The bank did not share any accounts. Make sure you select at least one account at the bank.",
  save: "We could not save the connection. Please try again.",
};

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ error?: string; reconnect?: string }> }) {
  const { error, reconnect } = await searchParams;
  const [today, connections] = await Promise.all([getToday(), getConnections()]);
  const providers = availableProviders();

  const institutions: InstitutionOption[] = [];
  let directoryError = false;
  for (const id of providers) {
    try {
      const list = await getProvider(id).listInstitutions("NO");
      institutions.push(...list.map((i) => ({ provider: id, name: i.name, country: i.country, beta: i.beta, demo: id === "demo" })));
    } catch (err) {
      console.error("[connect] institution list failed", describeBankError(err));
      directoryError = true;
    }
  }
  // Handelsbanken first, the demo bank last, everything else alphabetical.
  institutions.sort((a, b) => {
    const rank = (i: InstitutionOption) => (PREFERRED_INSTITUTION.test(i.name) ? 0 : i.demo ? 2 : 1);
    return rank(a) - rank(b) || a.name.localeCompare(b.name, "nb");
  });

  const existing = reconnect ? connections.find((c) => c.id === reconnect) : undefined;
  const reconnectInfo = existing
    ? {
        id: existing.id,
        institution:
          institutions.find((i) => i.name === existing.institutionName && i.provider === existing.provider) ?? {
            provider: existing.provider,
            name: existing.institutionName,
            country: "NO",
            beta: false,
            demo: existing.provider === "demo",
          },
      }
    : undefined;

  return (
    <Page>
      <PageHeader
        title={existing ? "Renew bank access" : "Connect a bank"}
        back={{ href: "/settings/accounts", label: "Accounts" }}
      />
      {error && ERRORS[error] ? (
        <p role="alert" className="mb-8 rounded-md bg-brick-soft px-4 py-3 text-sm">
          {ERRORS[error]}
        </p>
      ) : null}
      {providers.length === 0 ? (
        <EmptyState title="Bank connections are not set up yet.">
          Add your Enable Banking application id and private key to the server environment (see the README), or set
          ENABLE_DEMO_BANK=true for local development.
        </EmptyState>
      ) : institutions.length === 0 ? (
        <EmptyState title="The bank directory is unavailable.">
          {directoryError ? "We could not reach Enable Banking. Please try again in a few minutes." : "No banks are available."}
        </EmptyState>
      ) : (
        <ConnectForm institutions={institutions} today={today} reconnect={reconnectInfo} />
      )}
    </Page>
  );
}
