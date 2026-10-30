import { describe, expect, it } from "vitest";
import { BankApiError, describeBankError } from "./types";

describe("describeBankError", () => {
  it("includes the provider code, status and explanation", () => {
    const err = new BankApiError("Enable Banking GET /aspsps failed", "UNAUTHORIZED", 401, "Application is not active");
    expect(describeBankError(err)).toBe("UNAUTHORIZED (HTTP 401): Application is not active");
  });

  it("describes local errors such as an unreadable key, on one short line", () => {
    const err = new TypeError("error:1E08010C:DECODER routines::unsupported\n  more");
    expect(describeBankError(err)).toBe("TypeError: error:1E08010C:DECODER routines::unsupported more");
    expect(describeBankError(new Error("x".repeat(1000))).length).toBe(300);
  });
});
