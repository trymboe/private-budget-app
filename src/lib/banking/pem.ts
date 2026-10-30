// Turns whatever a dashboard did to a pasted private key back into a valid PEM.
// Seen in practice: line breaks turned into spaces, literal "\n", CRLF, wrapping
// quotes, or the whole file base64-encoded (with or without line wrapping).

const PEM = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

export function normalizePrivateKeyPem(raw: string): string {
  let text = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!text.includes("-----BEGIN")) text = Buffer.from(text, "base64").toString("utf8");
  text = text.replace(/\\r/g, "").replace(/\\n/g, "\n");

  const match = PEM.exec(text);
  if (!match) {
    throw new Error("ENABLE_BANKING_PRIVATE_KEY is not a PEM key: no BEGIN/END lines found");
  }
  const label = match[1];
  if (!label.endsWith("PRIVATE KEY")) {
    throw new Error(`ENABLE_BANKING_PRIVATE_KEY holds a ${label}, not the private key`);
  }
  if (label.startsWith("ENCRYPTED")) {
    throw new Error("ENABLE_BANKING_PRIVATE_KEY is password-protected; export it without a password");
  }
  const body = match[2].replace(/[^A-Za-z0-9+/=]/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}
