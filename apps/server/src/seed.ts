/**
 * Creates the dev user with two cabinets and a few packages, so MCP has
 * something to show. Safe to run twice: it starts the dev user from scratch.
 * Usage: pnpm db:seed
 */
import { addItems, createCabinet, type Ctx } from "@remedy/core";
import { anonymousUser, createDb, eq, user } from "@remedy/db";
import { DEV_USER_ID } from "./app.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const { db, close } = createDb(url);
const ctx: Ctx = { db, userId: DEV_USER_ID, actor: { kind: "app" } };

await db.delete(user).where(eq(user.id, DEV_USER_ID));
await db.insert(user).values(anonymousUser(DEV_USER_ID));

await createCabinet(ctx, { name: "Дом" });
await createCabinet(ctx, { name: "Машина" });

const today = new Date();
const inMonths = (n: number) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + n, 15));
  return d.toISOString().slice(0, 10);
};

await addItems(ctx, {
  cabinet: "Дом",
  items: [
    { name: "Нурофен", substance: "ибупрофен", form: "таблетки", dosage: "200 мг", expiry: inMonths(14), category: "pain_fever" },
    { name: "Парацетамол", substance: "парацетамол", form: "таблетки", dosage: "500 мг", expiry: inMonths(-1), category: "pain_fever" },
    { name: "Називин", substance: "оксиметазолин", form: "спрей", dosage: "0,05%", expiry: inMonths(0), category: "cold_flu" },
    { name: "Супрастин", substance: "хлоропирамин", form: "таблетки", dosage: "25 мг", expiry: inMonths(20), category: "allergy" },
  ],
});
await addItems(ctx, {
  cabinet: "Машина",
  items: [
    { name: "Бинт стерильный", form: "бинт", expiry: inMonths(36), category: "first_aid" },
    { name: "Хлоргексидин", substance: "хлоргексидин", form: "раствор", dosage: "0,05%", expiry: inMonths(1), category: "first_aid" },
  ],
});

console.log(`Seeded user "${DEV_USER_ID}" with 2 cabinets and 6 packages`);
await close();
