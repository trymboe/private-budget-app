import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { bankingEnv } from "@/lib/env";

// AES-256-GCM for provider session references at rest. The key lives only in the
// server environment (BANK_TOKEN_ENCRYPTION_KEY, 32 random bytes, base64).
// Format: v1.<iv>.<tag>.<ciphertext> (base64url parts).

function key(): Buffer {
  const raw = Buffer.from(bankingEnv().BANK_TOKEN_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) throw new Error("BANK_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return raw;
}

export function encryptSecret(plaintext: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, k: Buffer = key()): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Unguessable value for the OAuth-style `state` parameter. */
export function randomState(): string {
  return randomBytes(32).toString("base64url");
}
