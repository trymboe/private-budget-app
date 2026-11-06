import { addDays, minDate, monthEnd, type IsoDate } from "@/lib/dates";
import type { ConnectionSummary } from "./types";

/** True when the data for `month` is known to be incomplete for budget accounts. */
export function isMonthPartial(connections: ConnectionSummary[], month: IsoDate): boolean {
  const end = monthEnd(month);
  const accounts = connections.flatMap((c) => c.accounts).filter((a) => a.isSynced && a.includeInBudget);
  const imports = accounts.filter((a) => a.importedThrough !== null);
  // Imported history (e.g. from Buddy) stands in for a bank account in the months
  // before the bank's history starts, as long as it covers the whole gap.
  const coveredByImport = (bankStart: IsoDate) =>
    imports.some(
      (i) =>
        i.historyAvailableFrom !== null &&
        i.historyAvailableFrom <= month &&
        i.importedThrough! >= minDate(end, addDays(bankStart, -1)),
    );
  return accounts.some((a) => {
    if (!a.initialImportCompletedAt) return true;
    if (a.importedThrough !== null) {
      // Before the imported history starts, it says nothing; that is only a gap
      // when no other account covers the month either (checked by the bank rules).
      return a.historyAvailableFrom !== null && a.historyAvailableFrom > month && a.historyAvailableFrom <= end;
    }
    const start = a.historyAvailableFrom !== null && a.historyAvailableFrom > month ? a.historyAvailableFrom : null;
    const requested = a.historyRequestedFrom !== null && a.historyRequestedFrom > month && a.historyRequestedFrom <= end;
    if (start !== null && !coveredByImport(start)) return true;
    if (requested && !(a.historyRequestedFrom && coveredByImport(a.historyRequestedFrom))) return true;
    return false;
  });
}
