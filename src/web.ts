/**
 * Web config panel: Hono server with auth + config CRUD.
 * Single HTML page, no build step.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { serve } from '@hono/node-server';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { isInitialized, setupAdmin, login, logout, validateSession } from './auth.js';
import { getAllConfig, setConfigs, getConfigKeys, type ConfigKey } from './config-store.js';

const app = new Hono();

const isProduction = process.env.NODE_ENV === 'production';

// ── Auth middleware ──
const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'session');
  if (!token || !validateSession(token)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

// ── API routes ──

// Check init status
app.get('/api/status', (c) => {
  return c.json({ initialized: isInitialized() });
});

// First-run setup
app.post('/api/setup', async (c) => {
  if (isInitialized()) return c.json({ error: 'already initialized' }, 400);
  const { username, password } = await c.req.json();
  try {
    setupAdmin(username, password);
    const token = login(username, password);
    if (token) setCookie(c, 'session', token, { httpOnly: true, sameSite: 'Lax', secure: isProduction, maxAge: 86400, path: '/' });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Login
app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json();
  const token = login(username, password);
  if (!token) return c.json({ error: 'invalid credentials' }, 401);
  setCookie(c, 'session', token, { httpOnly: true, sameSite: 'Lax', secure: isProduction, maxAge: 86400, path: '/' });
  return c.json({ ok: true });
});

// Logout
app.post('/api/logout', (c) => {
  const token = getCookie(c, 'session');
  if (token) logout(token);
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

// Get config (auth required)
app.get('/api/config', requireAuth, (c) => {
  const config = getAllConfig();
  // Mask sensitive values for display
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value && (key.includes('TOKEN') || key.includes('KEY') || key.includes('SECRET'))) {
      masked[key] = value.slice(0, 6) + '***';
    } else {
      masked[key] = value;
    }
  }
  return c.json({ config: masked, keys: getConfigKeys() });
});

// Update config (auth required)
app.put('/api/config', requireAuth, async (c) => {
  const body = await c.req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'invalid payload' }, 400);
  }
  const entries: Partial<Record<ConfigKey, string>> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string') {
      return c.json({ error: `invalid value for ${key}: expected string` }, 400);
    }
    entries[key as ConfigKey] = value;
  }
  setConfigs(entries);
  return c.json({ ok: true });
});

// ── Frontend ──
app.get('/', (c) => {
  return c.html(FRONTEND_HTML);
});

// ── Start server ──
const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);

export function startWebServer(): void {
  serve({ fetch: app.fetch, port: WEB_PORT }, () => {
    console.log(`[Web] 設定頁面已啟動: http://localhost:${WEB_PORT}`);
  });
}

// ── Inline frontend ──
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>banini-tracker 設定</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0f0f1a; color: #e0e0e0; min-height: 100vh; display: flex; justify-content: center; align-items: flex-start; padding: 2rem; }
  .container { max-width: 520px; width: 100%; }
  h1 { font-size: 1.4rem; margin-bottom: 1.5rem; color: #fff; }
  .card { background: #1a1a2e; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
  label { display: block; font-size: 0.85rem; color: #888; margin-bottom: 0.3rem; margin-top: 0.8rem; }
  input { width: 100%; padding: 0.5rem; background: #0f0f1a; border: 1px solid #333; border-radius: 4px; color: #e0e0e0; font-size: 0.9rem; }
  input:focus { outline: none; border-color: #4a9eff; }
  button { padding: 0.6rem 1.2rem; background: #4a9eff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; margin-top: 1rem; }
  button:hover { background: #3a8eef; }
  button.secondary { background: #333; }
  .msg { padding: 0.5rem; border-radius: 4px; margin-top: 0.5rem; font-size: 0.85rem; }
  .msg.ok { background: #1a3a1a; color: #4caf50; }
  .msg.err { background: #3a1a1a; color: #f44336; }
  .section-title { font-size: 0.9rem; color: #4a9eff; margin-bottom: 0.5rem; font-weight: 600; }
  .divider { border-top: 1px solid #333; margin: 1rem 0; }
  .hint { font-size: 0.75rem; color: #666; }
</style>
</head>
<body>
<div class="container">
  <h1>banini-tracker 設定</h1>

  <!-- Setup / Login -->
  <div id="auth-card" class="card" style="display:none">
    <div class="section-title" id="auth-title">Login</div>
    <label>帳號</label>
    <input id="auth-user" autocomplete="username">
    <label>密碼</label>
    <input id="auth-pass" type="password" autocomplete="current-password">
    <button onclick="doAuth()">確認</button>
    <div id="auth-msg"></div>
  </div>

  <!-- Config -->
  <div id="config-card" class="card" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="section-title">環境變數設定</div>
      <button class="secondary" onclick="doLogout()" style="margin:0;padding:0.3rem 0.8rem;font-size:0.8rem">登出</button>
    </div>

    <div class="divider"></div>
    <div class="section-title">必填</div>
    <label>APIFY_TOKEN</label>
    <input id="cfg-APIFY_TOKEN" placeholder="apify_api_...">
    <label>LLM_API_KEY</label>
    <input id="cfg-LLM_API_KEY" placeholder="API key for AI analysis">

    <div class="divider"></div>
    <div class="section-title">Telegram（選填）</div>
    <label>TG_BOT_TOKEN</label>
    <input id="cfg-TG_BOT_TOKEN">
    <label>TG_CHANNEL_ID</label>
    <input id="cfg-TG_CHANNEL_ID" placeholder="-100...">

    <div class="divider"></div>
    <div class="section-title">Discord（選填）</div>
    <label>DISCORD_BOT_TOKEN</label>
    <input id="cfg-DISCORD_BOT_TOKEN">
    <label>DISCORD_CHANNEL_ID</label>
    <input id="cfg-DISCORD_CHANNEL_ID">

    <div class="divider"></div>
    <div class="section-title">LINE（選填）</div>
    <label>LINE_CHANNEL_ACCESS_TOKEN</label>
    <input id="cfg-LINE_CHANNEL_ACCESS_TOKEN">
    <label>LINE_TO</label>
    <input id="cfg-LINE_TO" placeholder="userId or groupId">

    <div class="divider"></div>
    <div class="section-title">進階（選填）</div>
    <label>LLM_BASE_URL</label>
    <input id="cfg-LLM_BASE_URL">
    <label>LLM_MODEL</label>
    <input id="cfg-LLM_MODEL">
    <label>TRANSCRIBER</label>
    <input id="cfg-TRANSCRIBER" placeholder="noop / groq">
    <label>GROQ_API_KEY</label>
    <input id="cfg-GROQ_API_KEY">
    <label>FINMIND_TOKEN</label>
    <input id="cfg-FINMIND_TOKEN">
    <p class="hint" style="margin-top:0.3rem">LLM_BASE_URL 預設 DeepInfra，LLM_MODEL 預設 MiniMax-M2.5</p>

    <button onclick="saveConfig()">儲存設定</button>
    <div id="config-msg"></div>
  </div>
</div>

<script>
let configKeys = [];
let originalValues = {};
let isSetup = false;

async function init() {
  const res = await fetch('/api/status');
  const { initialized } = await res.json();
  if (!initialized) {
    isSetup = true;
    document.getElementById('auth-title').textContent = '初始化管理員帳號';
    document.getElementById('auth-card').style.display = 'block';
    return;
  }
  const cfgRes = await fetch('/api/config');
  if (cfgRes.status === 401) {
    document.getElementById('auth-title').textContent = '登入';
    document.getElementById('auth-card').style.display = 'block';
    return;
  }
  showConfig(await cfgRes.json());
}

async function doAuth() {
  const user = document.getElementById('auth-user').value;
  const pass = document.getElementById('auth-pass').value;
  const url = isSetup ? '/api/setup' : '/api/login';
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
  const data = await res.json();
  if (!res.ok) { showMsg('auth-msg', data.error, true); return; }
  document.getElementById('auth-card').style.display = 'none';
  const cfgRes = await fetch('/api/config');
  showConfig(await cfgRes.json());
}

function showConfig(data) {
  configKeys = data.keys || [];
  originalValues = {};
  document.getElementById('config-card').style.display = 'block';
  for (const key of configKeys) {
    const el = document.getElementById('cfg-' + key);
    const val = data.config[key] || '';
    if (el) el.value = val;
    originalValues[key] = val;
  }
}

async function saveConfig() {
  const body = {};
  for (const key of configKeys) {
    const el = document.getElementById('cfg-' + key);
    const val = el ? el.value.trim() : '';
    if (val !== originalValues[key]) body[key] = val;
  }
  const res = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { showMsg('config-msg', data.error, true); return; }
  showMsg('config-msg', '設定已儲存，下次排程執行時生效', false);
  const cfgRes = await fetch('/api/config');
  if (cfgRes.ok) showConfig(await cfgRes.json());
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  document.getElementById('config-card').style.display = 'none';
  document.getElementById('auth-title').textContent = '登入';
  document.getElementById('auth-card').style.display = 'block';
}

function showMsg(id, text, isErr) {
  const el = document.getElementById(id);
  el.className = 'msg ' + (isErr ? 'err' : 'ok');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
}

init();
</script>
</body>
</html>`;
