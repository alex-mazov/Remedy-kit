/**
 * Accounts and agent access, on Better Auth.
 *
 * - Accounts are anonymous: a random id, no email or phone. The user signs in
 *   with a passkey bound to our domain.
 * - Agents (Claude, ChatGPT) get access via OAuth 2.1 following the MCP
 *   authorization profile 2026-07-28: Client ID Metadata Documents for client
 *   registration, protected resource metadata, PKCE, tokens bound to /mcp.
 * - Everything is stored in our own Postgres; no external auth service.
 */
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { mcp } from "@better-auth/mcp";
import { passkey } from "@better-auth/passkey";
import { schema, type Db } from "@remedy/db";
import { betterAuth } from "better-auth";
import { anonymous, jwt } from "better-auth/plugins";

/** Scopes an agent can ask for. Read is enough to answer questions; write lets it change cabinets. */
export const SCOPES = {
  read: "remedy:read",
  write: "remedy:write",
} as const;

export interface AuthConfig {
  db: Db;
  /** Public origin of this server, e.g. https://remedy.example.com. Passkeys are bound to its host. */
  publicUrl: string;
  /** At least 32 random characters. Signs cookies and OAuth state. */
  secret: string;
}

export function mcpResource(publicUrl: string): string {
  return `${publicUrl}/mcp`;
}

export function createAuth({ db, publicUrl, secret }: AuthConfig) {
  const host = new URL(publicUrl).hostname;

  return betterAuth({
    appName: "Remedy Kit",
    baseURL: publicUrl,
    basePath: "/api/auth",
    secret,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: { ipAddress: { disableIpTracking: true } },
    databaseHooks: {
      // Sessions keep no IP address or browser fingerprint: nothing that points to a person.
      session: { create: { before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }) } },
    },
    user: {
      additionalFields: {
        region: { type: "string", required: false, defaultValue: "default", input: false },
        notifyDays: { type: "number", required: false, defaultValue: 30, input: false },
        locale: { type: "string", required: false, defaultValue: "ru", input: false },
        timezone: { type: "string", required: false, defaultValue: "Asia/Almaty", input: false },
      },
    },
    plugins: [
      // Anonymous accounts get a placeholder email on a reserved TLD: it can never receive mail.
      anonymous({ emailDomainName: "anon.invalid", generateName: () => "Аптечка" }),
      passkey({ rpID: host, rpName: "Remedy Kit", origin: publicUrl }),
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: mcpResource(publicUrl),
        scopes: ["openid", "profile", "offline_access", SCOPES.read, SCOPES.write],
        // Deprecated in MCP 2026-07-28 but kept until Claude and ChatGPT are confirmed to work with CIMD alone.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
