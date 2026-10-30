import "server-only";
import { isDemoBankEnabled, isEnableBankingConfigured } from "@/lib/env";
import { demoBank } from "./demo";
import { enableBanking } from "./enable-banking";
import type { BankProvider, ProviderId } from "./types";

export function getProvider(id: ProviderId): BankProvider {
  if (id === "demo") {
    if (!isDemoBankEnabled()) throw new Error("The demo bank is disabled");
    return demoBank;
  }
  return enableBanking;
}

export function availableProviders(): ProviderId[] {
  const ids: ProviderId[] = [];
  if (isEnableBankingConfigured()) ids.push("enable_banking");
  if (isDemoBankEnabled()) ids.push("demo");
  return ids;
}

/** Handelsbanken Norway is the first target; any Norwegian bank Enable Banking lists works the same way. */
export const PREFERRED_INSTITUTION = /handelsbanken/i;
