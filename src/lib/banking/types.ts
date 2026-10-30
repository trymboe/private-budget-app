// Provider-neutral banking types. Each bank aggregator (Enable Banking today, a
// demo provider for local development) implements BankProvider; the sync engine
// only ever talks to this interface.
import type { IsoDate } from "@/lib/dates";
import type { Minor } from "@/lib/money";

export type ProviderId = "enable_banking" | "demo";

export type Institution = {
  name: string;
  country: string;
  logoUrl: string | null;
  /** Longest consent the bank supports, in seconds (null when unknown). */
  maxConsentSeconds: number | null;
  beta: boolean;
};

export type ProviderAccount = {
  /** Session-scoped id used for API calls. */
  uid: string;
  /** Stable identity across sessions (used to re-attach accounts on reconnect). */
  identity: string;
  name: string;
  ibanMasked: string | null;
  currency: string;
};

export type AuthorizationStart = { url: string };

export type CompletedAuthorization = {
  sessionId: string;
  validUntil: string | null; // ISO timestamp
  accounts: ProviderAccount[];
};

export type RawTransactionPage = {
  transactions: unknown[];
  continuationKey: string | null;
};

export type NormalizedTransaction = {
  providerRef: string | null;
  /** Fingerprint without the occurrence suffix; see withOccurrence(). */
  fingerprintBase: string;
  status: "booked" | "pending";
  bookingDate: IsoDate | null;
  valueDate: IsoDate | null;
  transactionDate: IsoDate | null;
  effectiveDate: IsoDate;
  amountMinor: Minor;
  currency: string;
  originalAmountMinor: Minor | null;
  originalCurrency: string | null;
  counterparty: string | null;
  description: string | null;
  merchantKey: string | null;
  merchantCategoryCode: string | null;
  bankMeta: Record<string, unknown>;
};

export class BankApiError extends Error {
  constructor(
    message: string,
    /** Machine-readable code, e.g. EXPIRED_SESSION, ASPSP_RATE_LIMIT_EXCEEDED. */
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BankApiError";
  }

  /** Consent is gone; the user has to re-authorise at their bank. */
  get isConsentProblem() {
    return (
      this.code === "EXPIRED_SESSION" ||
      this.code === "REVOKED_SESSION" ||
      this.code === "CLOSED_SESSION" ||
      this.code === "SESSION_DOES_NOT_EXIST" ||
      this.code === "ACCOUNT_DOES_NOT_EXIST" ||
      this.status === 401
    );
  }

  get isRateLimited() {
    return this.status === 429 || this.code === "ASPSP_RATE_LIMIT_EXCEEDED";
  }
}

export interface BankProvider {
  readonly id: ProviderId;
  listInstitutions(country: string): Promise<Institution[]>;
  startAuthorization(input: {
    institution: { name: string; country: string };
    validUntil: Date;
    state: string;
    redirectUrl: string;
  }): Promise<AuthorizationStart>;
  completeAuthorization(code: string): Promise<CompletedAuthorization>;
  fetchTransactions(input: {
    sessionId: string;
    accountUid: string;
    dateFrom: IsoDate;
    dateTo: IsoDate | null;
    continuationKey: string | null;
    strategy?: "default" | "longest";
  }): Promise<RawTransactionPage>;
  fetchBalance(input: { sessionId: string; accountUid: string }): Promise<{ amountMinor: Minor; currency: string } | null>;
  normalize(raw: unknown, accountCurrency: string): NormalizedTransaction | null;
  revoke(sessionId: string): Promise<void>;
}
