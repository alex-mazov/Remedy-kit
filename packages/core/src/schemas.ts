/**
 * Input schemas shared by every adapter: MCP tool inputs, REST bodies and
 * the app's forms all validate against these.
 */
import { z } from "zod";

/** Cabinet id (uuid) or its name, case-insensitive. */
export const CabinetRef = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("Cabinet id or name, e.g. 'Home' or 'Car'. Case-insensitive.");

/** `YYYY-MM-DD`, or `YYYY-MM` when the package shows only month and year. */
export const ExpiryInput = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, "Use YYYY-MM-DD or YYYY-MM")
  .describe("Expiry date as YYYY-MM-DD, or YYYY-MM when only month and year are printed.");

export const ItemInput = z
  .object({
    name: z.string().trim().min(1).max(200).optional().describe("Product name as printed on the package."),
    substance: z.string().trim().max(200).optional().describe("Active substance (INN), if printed."),
    form: z.string().trim().max(100).optional().describe("Dosage form: tablets, syrup, spray, ointment..."),
    dosage: z.string().trim().max(100).optional().describe("Strength, e.g. '500 mg' or '0.1%'."),
    expiry: ExpiryInput.optional(),
    quantity: z.number().int().positive().max(10_000).optional().describe("How many units are left, if known."),
    unit: z.string().trim().max(30).optional().describe("Unit for quantity: tablets, ml, pcs."),
    category: z.string().trim().max(50).optional().describe("Category key from list_categories, e.g. 'pain_fever'."),
    notes: z.string().trim().max(500).optional(),
    dataMatrix: z
      .string()
      .max(500)
      .optional()
      .describe("Raw content of the marking DataMatrix code, if it was read. GTIN, serial, batch and expiry are taken from it."),
  })
  .refine((v) => v.name || v.dataMatrix, { message: "Either name or dataMatrix is required" });
export type ItemInput = z.infer<typeof ItemInput>;

export const AddItemsInput = z.object({
  cabinet: CabinetRef,
  createCabinetIfMissing: z
    .boolean()
    .default(false)
    .describe("Create the cabinet when no cabinet has this name. Ask the user first."),
  items: z.array(ItemInput).min(1).max(20),
});
export type AddItemsInput = z.input<typeof AddItemsInput>;

export const ItemStatusInput = z.enum(["in_stock", "discarded", "used_up", "any"]);

export const SearchItemsInput = z.object({
  query: z.string().trim().max(100).optional().describe("Text to find in name or active substance."),
  cabinet: CabinetRef.optional(),
  category: z.string().trim().max(50).optional().describe("Category key."),
  status: ItemStatusInput.default("in_stock"),
  expiringWithinDays: z.number().int().min(0).max(3650).optional().describe("Only items expiring within N days (expired included)."),
  limit: z.number().int().min(1).max(200).default(50),
});
export type SearchItemsInput = z.input<typeof SearchItemsInput>;

export const ListExpiringInput = z.object({
  withinDays: z.number().int().min(0).max(3650).optional().describe("Defaults to the user's reminder setting (30 days)."),
});
export type ListExpiringInput = z.input<typeof ListExpiringInput>;

export const CreateCabinetInput = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateCabinetInput = z.input<typeof CreateCabinetInput>;
