import { user, type User } from "@remedy/db";
import { eq } from "drizzle-orm";
import { CoreError, type Ctx } from "./context.ts";

export type Settings = Pick<User, "notifyDays" | "timezone" | "locale" | "region">;

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const [row] = await ctx.db
    .select({ notifyDays: user.notifyDays, timezone: user.timezone, locale: user.locale, region: user.region })
    .from(user)
    .where(eq(user.id, ctx.userId));
  if (!row) throw new CoreError("not_found", "User not found.");
  return row;
}
