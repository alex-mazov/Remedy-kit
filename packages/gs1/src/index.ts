/**
 * Parsing of codes printed on medicine packages.
 *
 * - GS1 DataMatrix (the marking code on packages): GTIN, serial number,
 *   batch and, when the producer included it, the expiry date.
 * - Plain linear barcodes (EAN-13, UPC-A, EAN-8): GTIN only.
 *
 * Shared by the mobile app (parses on the device) and the server
 * (the agent may pass a raw DataMatrix string to `add_items`).
 *
 * Note: not every market puts the expiry date in the code. Kazakhstan's
 * marking code carries it; Russia's medicine codes (01/21/91/92) do not.
 * Callers must treat `expiry` as optional and fall back to manual entry.
 */

/** ASCII Group Separator (FNC1 inside the symbol), as most scanners return it. */
export const GS = "\u001d";

export interface ExpiryDate {
  /** ISO date `YYYY-MM-DD`. For month-only codes, the last day of that month. */
  date: string;
  /** `month` when the code said day `00` (only month and year are known). */
  precision: "day" | "month";
}

export interface Gs1Result {
  gtin?: string;
  serial?: string;
  batch?: string;
  expiry?: ExpiryDate;
  /** Every application identifier found, as raw strings. */
  fields: Record<string, string>;
}

export class Gs1ParseError extends Error {
  override name = "Gs1ParseError";
}

/** Fixed-length application identifiers we may meet: AI -> data length. */
const FIXED: Record<string, number> = {
  "00": 18,
  "01": 14,
  "02": 14,
  "11": 6,
  "13": 6,
  "15": 6,
  "16": 6,
  "17": 6,
};

/** Variable-length identifiers we know about: AI -> max data length. */
const VARIABLE: Record<string, number> = {
  "10": 20, // batch / lot
  "21": 20, // serial number
  "240": 30,
  "91": 90, // company internal (verification key in RU/KZ marking)
  "92": 90, // company internal (crypto tail)
  "93": 90,
};

/** Validates the GS1 mod-10 check digit of a GTIN-8/12/13/14. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // Weights 3,1,3,1... from the rightmost data digit.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i]! * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Normalises GTIN-8/12/13/14 to 14 digits. */
export function toGtin14(code: string): string {
  if (!isValidGtin(code)) throw new Gs1ParseError(`Invalid GTIN: ${code}`);
  return code.padStart(14, "0");
}

/**
 * Converts a GS1 YYMMDD date to an expiry date.
 * The century follows the GS1 sliding window around `referenceYear`.
 */
export function parseGs1Date(yymmdd: string, referenceYear = new Date().getUTCFullYear()): ExpiryDate {
  if (!/^\d{6}$/.test(yymmdd)) throw new Gs1ParseError(`Invalid date: ${yymmdd}`);
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) throw new Gs1ParseError(`Invalid month in date: ${yymmdd}`);

  const refCentury = Math.floor(referenceYear / 100) * 100;
  const diff = yy - (referenceYear % 100);
  let year = refCentury + yy;
  if (diff >= 51) year -= 100;
  else if (diff <= -50) year += 100;

  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd > lastDay) throw new Gs1ParseError(`Invalid day in date: ${yymmdd}`);
  const day = dd === 0 ? lastDay : dd;
  const iso = `${year}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date: iso, precision: dd === 0 ? "month" : "day" };
}

/** Strips symbology identifiers and normalises the parenthesised human-readable form. */
function normalise(input: string): string {
  let s = input.trim();
  // Symbology identifiers some scanners prepend: ]d2 (DataMatrix), ]C1 (GS1-128), ]Q3 (QR).
  s = s.replace(/^\][A-Za-z]\d/, "");
  // A leading FNC1/GS carries no data.
  while (s.startsWith(GS)) s = s.slice(1);
  // Human-readable form: (01)04601234567893(21)ABC -> AI + data with GS between fields.
  if (s.startsWith("(")) {
    const parts = [...s.matchAll(/\((\d{2,4})\)([^(]*)/g)];
    if (parts.length === 0) throw new Gs1ParseError("Unrecognised bracketed GS1 string");
    s = parts.map(([, ai, data]) => `${ai}${data}`).join(GS);
  }
  return s;
}

function matchAi(s: string, pos: number): string | undefined {
  for (const len of [2, 3, 4]) {
    const ai = s.slice(pos, pos + len);
    if (ai in FIXED || ai in VARIABLE) return ai;
  }
  return undefined;
}

/** Parses a GS1 element string, e.g. the content of a marking DataMatrix. */
export function parseGs1(input: string, referenceYear?: number): Gs1Result {
  const s = normalise(input);
  const fields: Record<string, string> = {};
  let pos = 0;

  while (pos < s.length) {
    if (s[pos] === GS) {
      pos++;
      continue;
    }
    const ai = matchAi(s, pos);
    if (!ai) throw new Gs1ParseError(`Unknown application identifier at position ${pos}`);
    pos += ai.length;

    let value: string;
    const fixed = FIXED[ai];
    if (fixed !== undefined) {
      value = s.slice(pos, pos + fixed);
      if (value.length !== fixed) throw new Gs1ParseError(`Truncated value for AI ${ai}`);
      pos += fixed;
    } else {
      const end = s.indexOf(GS, pos);
      value = s.slice(pos, end === -1 ? s.length : end);
      if (value.length > VARIABLE[ai]!) throw new Gs1ParseError(`Value too long for AI ${ai}`);
      pos += value.length;
    }
    fields[ai] = value;
  }

  const result: Gs1Result = { fields };
  if (fields["01"] !== undefined) result.gtin = toGtin14(fields["01"]);
  if (fields["21"] !== undefined) result.serial = fields["21"];
  if (fields["10"] !== undefined) result.batch = fields["10"];
  if (fields["17"] !== undefined) result.expiry = parseGs1Date(fields["17"], referenceYear);
  return result;
}

/**
 * Parses whatever a camera returned: a plain EAN/UPC barcode or a GS1 DataMatrix.
 * Returns `null` for codes that carry nothing we can use (no GTIN).
 */
export function parseBarcode(input: string, referenceYear?: number): Gs1Result | null {
  const trimmed = input.trim();
  if (/^\d{8}$|^\d{12,13}$/.test(trimmed)) {
    return isValidGtin(trimmed) ? { gtin: toGtin14(trimmed), fields: { "01": toGtin14(trimmed) } } : null;
  }
  try {
    const result = parseGs1(trimmed, referenceYear);
    return result.gtin ? result : null;
  } catch {
    return null;
  }
}
