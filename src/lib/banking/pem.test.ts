import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePrivateKeyPem } from "./pem";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const loads = (value: string) => createPrivateKey(normalizePrivateKeyPem(value)).asymmetricKeyType;

describe("normalizePrivateKeyPem", () => {
  it("accepts the PEM as downloaded", () => {
    expect(loads(pem)).toBe("rsa");
    expect(loads(pkcs1)).toBe("rsa");
  });

  it("repairs line breaks turned into spaces, CRLF, literal \\n and quotes", () => {
    expect(loads(pem.replace(/\n/g, " "))).toBe("rsa");
    expect(loads(pem.replace(/\n/g, "\r\n"))).toBe("rsa");
    expect(loads(pem.replace(/\n/g, "\\n"))).toBe("rsa");
    expect(loads(`"${pem}"`)).toBe("rsa");
  });

  it("accepts the base64-encoded file, wrapped or not", () => {
    const b64 = Buffer.from(pem).toString("base64");
    expect(loads(b64)).toBe("rsa");
    expect(loads(b64.replace(/.{76}/g, "$&\n"))).toBe("rsa");
  });

  it("explains common mistakes instead of a decoder error", () => {
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => normalizePrivateKeyPem(pub)).toThrow("holds a PUBLIC KEY");
    expect(() => normalizePrivateKeyPem("4f1c2d9a-0000-1111-2222-333344445555")).toThrow("no BEGIN/END lines");
  });
});
