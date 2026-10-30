/**
 * Turns an untrusted `next` value into a same-site path, or "/".
 *
 * A prefix check is not enough: browsers and the URL parser read "/\evil.com"
 * and "/\t/evil.com" as "//evil.com", a link to another site. Resolving against
 * a dummy origin and requiring that origin back catches every such form.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const base = "https://same-site.invalid";
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return "/";
  }
  if (url.origin !== base) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
