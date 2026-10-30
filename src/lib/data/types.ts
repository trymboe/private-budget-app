import type { IsoDate } from "@/lib/dates";
import type { Minor } from "@/lib/money";

export type Category = {
  id: string;
  name: string;
  kind: "expense" | "income";
  icon: string;
  color: string;
  isFixed: boolean;
  sortOrder: number;
  archived: boolean;
};

export type Treatment = "budget" | "transfer" | "excluded";

export type TransactionListItem = {
  id: string;
  accountId: string;
  accountName: string;
  status: "booked" | "pending";
  effectiveDate: IsoDate;
  amountMinor: Minor;
  currency: string;
  originalAmountMinor: Minor | null;
  originalCurrency: string | null;
  counterparty: string | null;
  description: string | null;
  merchantKey: string | null;
  treatment: Treatment;
  needsReview: boolean;
  note: string | null;
  removed: boolean;
  suggestedCategoryId: string | null;
  suggestedTreatment: Treatment | null;
  suggestionReason: string | null;
  allocations: { categoryId: string; amountMinor: Minor }[];
  isDemo: boolean;
  accountIncluded: boolean;
};

export type ConnectionSummary = {
  id: string;
  provider: "enable_banking" | "demo";
  institutionName: string;
  status: "active" | "expired" | "revoked" | "error";
  consentValidUntil: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  rateLimitedUntil: string | null;
  accounts: AccountSummary[];
};

export type AccountSummary = {
  id: string;
  name: string;
  ibanMasked: string | null;
  currency: string;
  isSynced: boolean;
  includeInBudget: boolean;
  historyRequestedFrom: IsoDate | null;
  historyAvailableFrom: IsoDate | null;
  historyLimited: boolean;
  initialImportCompletedAt: string | null;
  lastSyncedAt: string | null;
  balanceMinor: Minor | null;
  provider: string;
};
