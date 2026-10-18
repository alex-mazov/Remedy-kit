import { describe, expect, it } from "vitest";
import { GS, Gs1ParseError, isValidGtin, parseBarcode, parseGs1, parseGs1Date, toGtin14 } from "../src/index.ts";

describe("GTIN", () => {
  it("validates check digits", () => {
    expect(isValidGtin("4600000000009")).toBe(false);
    expect(isValidGtin("4601234567893")).toBe(true);
    expect(isValidGtin("04601234567893")).toBe(true);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("12345")).toBe(false);
  });

  it("normalises to 14 digits", () => {
    expect(toGtin14("4601234567893")).toBe("04601234567893");
    expect(() => toGtin14("4601234567890")).toThrow(Gs1ParseError);
  });
});

describe("GS1 dates", () => {
  it("parses a full date", () => {
    expect(parseGs1Date("270315", 2026)).toEqual({ date: "2027-03-15", precision: "day" });
  });

  it("treats day 00 as the last day of the month", () => {
    expect(parseGs1Date("280200", 2026)).toEqual({ date: "2028-02-29", precision: "month" });
    expect(parseGs1Date("271100", 2026)).toEqual({ date: "2027-11-30", precision: "month" });
  });

  it("applies the GS1 century window", () => {
    expect(parseGs1Date("990101", 2026).date).toBe("1999-01-01");
    expect(parseGs1Date("750101", 2026).date).toBe("2075-01-01");
  });

  it("rejects impossible dates", () => {
    expect(() => parseGs1Date("271301", 2026)).toThrow(Gs1ParseError);
    expect(() => parseGs1Date("270231", 2026)).toThrow(Gs1ParseError);
  });
});

describe("parseGs1", () => {
  const gtin = "04601234567893";

  it("reads GTIN, expiry, batch and serial separated by GS", () => {
    const code = `01${gtin}17270331` + `10AB123${GS}21SN0001XYZ`;
    expect(parseGs1(code, 2026)).toMatchObject({
      gtin,
      expiry: { date: "2027-03-31", precision: "day" },
      batch: "AB123",
      serial: "SN0001XYZ",
    });
  });

  it("handles marking codes with crypto tails (01/21/91/92) and no expiry", () => {
    const code = `]d2${GS}01${gtin}21abcDEF123456${GS}91EE10${GS}92dGVzdGNyeXB0b3RhaWw=`;
    const result = parseGs1(code, 2026);
    expect(result.gtin).toBe(gtin);
    expect(result.serial).toBe("abcDEF123456");
    expect(result.expiry).toBeUndefined();
    expect(result.fields["91"]).toBe("EE10");
  });

  it("accepts the human-readable bracketed form", () => {
    const result = parseGs1(`(01)${gtin}(17)280200(10)L-7(21)42`, 2026);
    expect(result).toMatchObject({ gtin, batch: "L-7", serial: "42", expiry: { date: "2028-02-29", precision: "month" } });
  });

  it("rejects garbage", () => {
    expect(() => parseGs1("hello world")).toThrow(Gs1ParseError);
    expect(() => parseGs1(`01${gtin.slice(0, 10)}`)).toThrow(Gs1ParseError);
  });
});

describe("parseBarcode", () => {
  it("returns a GTIN for EAN-13", () => {
    expect(parseBarcode("4601234567893")).toEqual({ gtin: "04601234567893", fields: { "01": "04601234567893" } });
  });

  it("returns null for codes without a usable GTIN", () => {
    expect(parseBarcode("4601234567890")).toBeNull();
    expect(parseBarcode("https://example.com")).toBeNull();
  });
});
