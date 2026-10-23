import { actionLog, user } from "@remedy/db";
import { GS } from "@remedy/gs1";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addItems,
  CoreError,
  createCabinet,
  expiryStatus,
  listCabinets,
  listCategories,
  listExpiring,
  searchItems,
  type Ctx,
} from "../src/index.ts";
import { setupTestDb } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupTestDb>>;
let closers: (() => Promise<void>)[] = [];

beforeEach(async () => {
  env = await setupTestDb();
  closers.push(env.close);
  await createCabinet(env.app, { name: "Дом" });
});

afterAll(async () => {
  await Promise.all(closers.map((c) => c()));
});

describe("expiryStatus", () => {
  it("is inclusive of the expiry day", () => {
    expect(expiryStatus("2026-10-19", "2026-10-19", 30)).toBe("expiring");
    expect(expiryStatus("2026-10-18", "2026-10-19", 30)).toBe("expired");
    expect(expiryStatus("2026-11-18", "2026-10-19", 30)).toBe("expiring");
    expect(expiryStatus("2026-11-19", "2026-10-19", 30)).toBe("ok");
    expect(expiryStatus(null, "2026-10-19", 30)).toBe("unknown");
  });
});

describe("cabinets", () => {
  it("rejects a duplicate name regardless of case", async () => {
    await expect(createCabinet(env.app, { name: "дом" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("lists cabinets with counts", async () => {
    await addItems(env.app, {
      cabinet: "дом",
      items: [
        { name: "Парацетамол", expiry: "2026-10-01" },
        { name: "Ибупрофен", expiry: "2026-11-01" },
        { name: "Бинт", expiry: "2030-01" },
      ],
    });
    const [home] = await listCabinets(env.app);
    expect(home).toMatchObject({ name: "Дом", itemCount: 3, expiredCount: 1, expiringCount: 1 });
  });
});

describe("addItems", () => {
  it("adds items, turns YYYY-MM into the last day of the month, logs one batch", async () => {
    const result = await addItems(env.agent, {
      cabinet: "Дом",
      items: [
        { name: "Нурофен", substance: "ибупрофен", dosage: "200 мг", expiry: "2027-02", category: "pain_fever" },
        { name: "Називин", expiry: "2027-05-15" },
      ],
    });
    expect(result.added).toHaveLength(2);
    expect(result.added[0]).toMatchObject({
      name: "Нурофен",
      cabinet: "Дом",
      expiry: "2027-02-28",
      expiryPrecision: "month",
      category: "pain_fever",
      expiryStatus: "ok",
    });
    const log = await env.db.select().from(actionLog).where(eq(actionLog.batchId, result.batchId));
    expect(log.filter((l) => l.action === "add_item")).toHaveLength(2);
    expect(log.every((l) => l.actor === "agent" && l.oauthClientId === "claude-test")).toBe(true);
  });

  it("reads GTIN, serial and expiry from a DataMatrix and does not add the same package twice", async () => {
    const code = `0104601234567893${"17270331"}21SERIAL001${GS}91EE10`;
    const first = await addItems(env.agent, { cabinet: "Дом", items: [{ name: "Аспирин", dataMatrix: code, expiry: "2027-01" }] });
    expect(first.added[0]).toMatchObject({ gtin: "04601234567893", expiry: "2027-03-31" });
    expect(first.warnings[0]).toMatch(/differs from the code/);

    const second = await addItems(env.agent, { cabinet: "Дом", items: [{ name: "Аспирин", dataMatrix: code }] });
    expect(second.added).toHaveLength(0);
    expect(second.skipped[0]?.reason).toMatch(/Already/);
  });

  it("feeds the product directory only from the app, then fills the name from it", async () => {
    const code = `0104601234567893${"17280100"}21A1`;
    await addItems(env.agent, { cabinet: "Дом", items: [{ name: "Guess from photo", dataMatrix: code }] });
    const unknown = await addItems(env.agent, { cabinet: "Дом", items: [{ dataMatrix: `0104601234567893${"17280100"}21A2` }] });
    expect(unknown.skipped[0]?.reason).toMatch(/Name is unknown/);

    await addItems(env.app, { cabinet: "Дом", items: [{ name: "Аспирин Кардио", dosage: "100 мг", dataMatrix: `0104601234567893${"17280100"}21A3` }] });
    const known = await addItems(env.agent, { cabinet: "Дом", items: [{ dataMatrix: `0104601234567893${"17280100"}21A4` }] });
    expect(known.added[0]).toMatchObject({ name: "Аспирин Кардио", dosage: "100 мг", expiry: "2028-01-31" });
  });

  it("reports the existing cabinets when the name is unknown", async () => {
    const err = await addItems(env.agent, { cabinet: "Машина", items: [{ name: "Бинт" }] }).catch((e) => e);
    expect(err).toBeInstanceOf(CoreError);
    expect(err).toMatchObject({ code: "not_found", details: { cabinets: ["Дом"] } });
  });

  it("creates the cabinet when asked", async () => {
    const result = await addItems(env.agent, { cabinet: "Машина", createCabinetIfMissing: true, items: [{ name: "Бинт" }] });
    expect(result.added[0]?.cabinet).toBe("Машина");
    expect((await listCabinets(env.app)).map((c) => c.name)).toEqual(["Дом", "Машина"]);
  });

  it("never touches another user's data", async () => {
    await addItems(env.app, { cabinet: "Дом", items: [{ name: "Секретное лекарство" }] });
    await env.db.insert(user).values({ id: "someone-else" });
    const other: Ctx = { ...env.agent, userId: "someone-else" };
    expect(await searchItems(other, { query: "Секретное" })).toEqual([]);
    await expect(addItems(other, { cabinet: "Дом", items: [{ name: "x" }] })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("search and expiry", () => {
  beforeEach(async () => {
    await addItems(env.app, {
      cabinet: "Дом",
      items: [
        { name: "Парацетамол", substance: "парацетамол", expiry: "2026-09-30" },
        { name: "Нурофен", substance: "ибупрофен", expiry: "2026-11-10" },
        { name: "Мирамистин", expiry: "2028-06" },
        { name: "Пластырь" },
      ],
    });
  });

  it("finds by name or substance, case-insensitive, soonest expiry first", async () => {
    expect((await searchItems(env.agent, { query: "ИБУПРОФЕН" })).map((i) => i.name)).toEqual(["Нурофен"]);
    expect((await searchItems(env.agent)).map((i) => i.name)).toEqual(["Парацетамол", "Нурофен", "Мирамистин", "Пластырь"]);
  });

  it("treats % and _ in the query literally", async () => {
    expect(await searchItems(env.agent, { query: "%" })).toEqual([]);
  });

  it("splits expired and expiring using the user's reminder window", async () => {
    const result = await listExpiring(env.agent);
    expect(result.today).toBe("2026-10-19");
    expect(result.withinDays).toBe(30);
    expect(result.expired.map((i) => i.name)).toEqual(["Парацетамол"]);
    expect(result.expiring.map((i) => i.name)).toEqual(["Нурофен"]);
  });

  it("lists the default categories", async () => {
    const categories = await listCategories(env.agent);
    expect(categories.map((c) => c.key)).toContain("pain_fever");
  });
});

