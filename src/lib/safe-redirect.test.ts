import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths with query and hash", () => {
    expect(safeNextPath("/settings/password")).toBe("/settings/password");
    expect(safeNextPath("/transactions?view=review#top")).toBe("/transactions?view=review#top");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "evil.example",
    "",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("rejects non-strings", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});
