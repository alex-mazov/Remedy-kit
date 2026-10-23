/**
 * Sign-in and consent pages shown when the user connects an agent.
 * Plain server-rendered HTML; the only script is the bundled auth client.
 */
import { build } from "esbuild";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { fileURLToPath } from "node:url";

let bundle: Promise<string> | undefined;

/** Bundles web/auth-pages.ts once per process. */
export function authScript(): Promise<string> {
  bundle ??= build({
    entryPoints: [fileURLToPath(new URL("../web/auth-pages.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
  }).then((r) => r.outputFiles[0]!.text);
  return bundle;
}

const STYLE = `
:root { color-scheme: light dark; --bg:#f6f7f4; --card:#fff; --ink:#1d2320; --muted:#5d6762; --accent:#2f6f4f; --line:#dfe3dd; --err:#a33; }
@media (prefers-color-scheme: dark) { :root { --bg:#121513; --card:#1b201d; --ink:#e8ece9; --muted:#9aa49f; --accent:#6fbf93; --line:#2c332f; --err:#f08080; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:16px; }
main { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:28px; }
h1 { font-size:22px; margin:0 0 8px; }
p { margin:0 0 16px; color:var(--muted); }
ul { margin:0 0 20px; padding-left:20px; }
li { margin:4px 0; }
button { width:100%; font:inherit; font-weight:600; padding:12px 16px; border-radius:10px; border:1px solid var(--accent); cursor:pointer; margin-top:10px; }
button.primary { background:var(--accent); color:var(--card); }
button.secondary { background:transparent; color:var(--accent); }
button:disabled { opacity:.6; cursor:wait; }
.client { font-weight:600; color:var(--ink); }
.error { color:var(--err); margin-top:16px; }
.note { font-size:14px; margin-top:20px; }
`;

function layout(page: string, title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Remedy Kit</title>
<style>${raw(STYLE)}</style>
</head>
<body data-page="${page}">
<main>
${body}
<p id="error" class="error" role="alert" hidden></p>
</main>
<script type="module" src="/assets/auth.js"></script>
</body>
</html>`;
}

export function signInPage() {
  return layout(
    "sign-in",
    "Вход",
    html`<h1>Remedy Kit</h1>
<p>Агент просит доступ к вашей домашней аптечке. Войдите, чтобы продолжить.</p>
<button id="sign-in" class="primary" type="button">Войти с ключом доступа</button>
<button id="create" class="secondary" type="button">Создать новую аптечку</button>
<p class="note">Аптечка не требует почты и телефона. Вход — по ключу доступа (Face ID, отпечаток или PIN устройства).
Ключ синхронизируется через iCloud или Google, поэтому сохранится при смене телефона.</p>`,
  );
}

const SCOPE_LABELS: Record<string, string> = {
  "remedy:read": "видеть, какие лекарства и где у вас лежат, и их сроки годности",
  "remedy:write": "добавлять, переносить и отмечать упаковки",
  offline_access: "оставаться подключённым, пока вы не отключите доступ",
};

export function consentPage(clientName: string, scopes: string[]) {
  const items = scopes.filter((s) => s in SCOPE_LABELS);
  return layout(
    "consent",
    "Доступ к аптечке",
    html`<h1>Доступ к аптечке</h1>
<p><span class="client">${clientName}</span> сможет:</p>
<ul>${items.map((s) => html`<li>${SCOPE_LABELS[s]}</li>`)}</ul>
<button id="allow" class="primary" type="button">Разрешить</button>
<button id="deny" class="secondary" type="button">Отказать</button>
<p class="note">Сервис только хранит данные. Советы о лечении даёт сам агент и его разработчик.
Отключить доступ можно в настройках коннекторов агента.</p>`,
  );
}

export function errorPage(message: string) {
  return layout("error", "Ошибка", html`<h1>Не получилось</h1><p>${message}</p>`);
}
