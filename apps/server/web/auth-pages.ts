/**
 * Browser code for the sign-in and consent pages. Bundled by esbuild at server
 * start (see src/web.ts) and served as /assets/auth.js.
 *
 * Two Better Auth clients on purpose:
 * - `plain` never carries the OAuth query, so creating an account and its
 *   passkey does not jump ahead to the agent before the passkey exists;
 * - `oauth` carries the signed OAuth query, so signing in or continuing
 *   resumes the agent's authorization flow.
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";

const plain = createAuthClient({ basePath: "/api/auth", plugins: [anonymousClient(), passkeyClient()] });
const oauth = createAuthClient({ basePath: "/api/auth", plugins: [passkeyClient(), oauthProviderClient()] });

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showError(message: string) {
  const box = el("error");
  box.textContent = message;
  box.hidden = false;
}

function busy(on: boolean) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) b.disabled = on;
}

/** Follows `{ redirect: true, url }` answers from the OAuth endpoints. */
function follow(data: unknown) {
  const d = data as { redirect?: boolean; url?: string } | null;
  if (d?.url) window.location.href = d.url;
}

async function signInWithPasskey() {
  busy(true);
  const res = await oauth.signIn.passkey();
  if (res.error) {
    busy(false);
    showError("Не получилось войти. Если на этом устройстве нет ключа доступа, создайте новую аптечку.");
    return;
  }
  // The server resumes the OAuth flow after a new session; if it did not redirect, continue explicitly.
  const next = await oauth.$fetch("/oauth2/continue", { method: "POST", body: { selected: true } });
  follow(next.data);
}

async function createAccount() {
  busy(true);
  const anon = await plain.signIn.anonymous();
  if (anon.error) {
    busy(false);
    showError("Не получилось создать аптечку. Попробуйте ещё раз.");
    return;
  }
  const key = await plain.passkey.addPasskey({ name: "Remedy Kit" });
  if (key?.error) {
    // Without a passkey the account could not be opened again: drop it and let the user retry.
    await plain.signOut();
    busy(false);
    showError("Ключ доступа не создан. Без него в аптечку не войти — попробуйте ещё раз.");
    return;
  }
  const next = await oauth.$fetch("/oauth2/continue", { method: "POST", body: { created: true } });
  if (next.error) {
    busy(false);
    showError("Аптечка создана, но продолжить подключение не удалось. Начните подключение заново.");
    return;
  }
  follow(next.data);
}

async function consent(accept: boolean) {
  busy(true);
  const res = await oauth.$fetch("/oauth2/consent", { method: "POST", body: { accept } });
  if (res.error) {
    busy(false);
    showError("Не получилось сохранить ответ. Начните подключение заново.");
    return;
  }
  follow(res.data);
}

const page = document.body.dataset.page;
if (page === "sign-in") {
  el("sign-in").addEventListener("click", () => void signInWithPasskey());
  el("create").addEventListener("click", () => void createAccount());
}
if (page === "consent") {
  el("allow").addEventListener("click", () => void consent(true));
  el("deny").addEventListener("click", () => void consent(false));
}
