/**
 * Web config panel: Hono server with auth + config CRUD.
 * Single HTML page, no build step.
 */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { isInitialized, setupAdmin, login, logout, validateSession } from './auth.js';
import { getAllConfig, setConfigs, getConfigKeys, getConfig, type ConfigKey } from './config-store.js';
import { fetchFacebookPosts } from './facebook.js';
import { analyzePosts } from './analyze.js';
import { createNotifiers, type ReportData, type PostSummary } from './notifiers/index.js';

const app = new Hono();

const isProduction = process.env.NODE_ENV === 'production';

// -- Auth middleware --
const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'session');
  if (!token || !validateSession(token)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

// -- API routes --

app.get('/api/status', (c) => {
  return c.json({ initialized: isInitialized() });
});

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

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json();
  const token = login(username, password);
  if (!token) return c.json({ error: 'invalid credentials' }, 401);
  setCookie(c, 'session', token, { httpOnly: true, sameSite: 'Lax', secure: isProduction, maxAge: 86400, path: '/' });
  return c.json({ ok: true });
});

app.post('/api/logout', (c) => {
  const token = getCookie(c, 'session');
  if (token) logout(token);
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/config', requireAuth, (c) => {
  const config = getAllConfig();
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

// Test pipeline (SSE streaming)
app.get('/api/test', requireAuth, (c) => {
  const FB_PAGE_URL = 'https://www.facebook.com/DieWithoutBang/';

  return streamSSE(c, async (stream) => {
    const send = async (step: string, status: 'ok' | 'fail' | 'info', detail: string) => {
      await stream.writeSSE({ data: JSON.stringify({ step, status, detail }) });
    };

    const apifyToken = getConfig('APIFY_TOKEN');
    const llmApiKey = getConfig('LLM_API_KEY');
    if (!apifyToken) { await send('config', 'fail', 'APIFY_TOKEN 未設定'); return; }
    if (!llmApiKey) { await send('config', 'fail', 'LLM_API_KEY 未設定'); return; }
    await send('config', 'ok', '設定檢查通過');

    let post: any;
    try {
      await send('fetch', 'info', '正在抓取貼文...');
      const posts = await fetchFacebookPosts(FB_PAGE_URL, apifyToken, 1);
      if (posts.length === 0) { await send('fetch', 'fail', '沒有抓到貼文'); return; }
      post = posts[0];
      const preview = (post.text || '（純圖片）').slice(0, 80);
      await send('fetch', 'ok', preview);
    } catch (err: any) {
      await send('fetch', 'fail', err.message); return;
    }

    let analysis: any;
    try {
      await send('analyze', 'info', '正在進行 AI 分析...');
      const localTime = new Date(post.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      let content = `[Facebook] ${post.text}`;
      if (post.ocrText) content += `\n[圖片 OCR] ${post.ocrText}`;
      if (post.captionText) content += `\n[影片轉錄] ${post.captionText}`;
      analysis = await analyzePosts(
        [{ text: content, timestamp: localTime, isToday: true }],
        {
          baseUrl: getConfig('LLM_BASE_URL') || 'https://api.deepinfra.com/v1/openai',
          apiKey: llmApiKey,
          model: getConfig('LLM_MODEL') || 'MiniMaxAI/MiniMax-M2.5',
        },
      );
      await send('analyze', 'ok', analysis.summary || '分析完成');
    } catch (err: any) {
      await send('analyze', 'fail', err.message); return;
    }

    const notifiers = createNotifiers();
    if (notifiers.length === 0) {
      await send('notify', 'fail', '未設定任何通知管道（Telegram / Discord / LINE）');
      return;
    }
    await send('notify', 'info', `正在推送至 ${notifiers.map(n => n.name).join(', ')}...`);
    const postSummary: PostSummary = {
      source: 'facebook',
      timestamp: new Date(post.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      isToday: true,
      text: (post.text || '').slice(0, 60),
      url: post.url,
    };
    const reportData: ReportData = {
      analysis, postCount: { fb: 1 }, posts: [postSummary], isFallback: false,
    };
    const results = await Promise.allSettled(notifiers.map((n) => n.send(reportData)));
    const sent: string[] = [];
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        sent.push(notifiers[i].name);
      } else {
        const reason = (results[i] as PromiseRejectedResult).reason;
        failed.push(`${notifiers[i].name}: ${reason instanceof Error ? reason.message : reason}`);
      }
    }
    if (failed.length > 0) {
      await send('notify', 'fail', `失敗：${failed.join('; ')}`);
    } else {
      await send('notify', 'ok', `已送出：${sent.join(', ')}`);
    }
    await send('done', 'ok', '測試完成');
  });
});

// -- Frontend --
app.get('/', (c) => {
  return c.html(FRONTEND_HTML);
});

// -- Start server --
const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);

export function startWebServer(): void {
  serve({ fetch: app.fetch, port: WEB_PORT }, () => {
    console.log(`[Web] 設定頁面已啟動: http://localhost:${WEB_PORT}`);
  });
}

// -- Inline frontend --
const FRONTEND_HTML = /* html */ `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>banini-tracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f8fafc;
    --surface: #ffffff;
    --surface-alt: #f1f5f9;
    --border: #e2e8f0;
    --border-hover: #cbd5e1;
    --border-focus: #10b981;
    --text: #18181b;
    --text-secondary: #52525b;
    --text-muted: #a1a1aa;
    --accent: #10b981;
    --accent-hover: #059669;
    --accent-subtle: rgba(16,185,129,0.07);
    --red: #dc2626;
    --red-subtle: rgba(220,38,38,0.06);
    --amber: #d97706;
    --amber-subtle: rgba(217,119,6,0.06);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
    --radius: 10px;
    --radius-lg: 14px;
    --font: 'Outfit', system-ui, -apple-system, sans-serif;
    --mono: 'SF Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
    --transition: 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: var(--font); background: var(--bg); color: var(--text);
    line-height: 1.6; -webkit-font-smoothing: antialiased;
  }

  /* ── Two-column layout ── */
  .layout {
    display: grid; grid-template-columns: 1fr 1fr;
    height: 100vh; height: 100dvh; gap: 0;
  }

  /* ── Left: config ── */
  .col-left {
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--surface);
    border-right: 1px solid var(--border);
  }
  .col-header {
    padding: 1.5rem 2rem 1.25rem;
    display: flex; justify-content: space-between; align-items: center;
    flex-shrink: 0; border-bottom: 1px solid var(--border);
  }
  .col-header h1 {
    font-size: 1.25rem; font-weight: 700; color: var(--text);
    letter-spacing: -0.02em; display: flex; align-items: center; gap: 0.6rem;
  }
  .tag {
    font-family: var(--mono); font-size: 0.7rem; font-weight: 600;
    padding: 0.2rem 0.6rem; background: var(--accent-subtle);
    color: var(--accent); border-radius: 100px; letter-spacing: 0.03em;
  }
  .col-scroll {
    flex: 1; overflow-y: auto; padding: 1.75rem 2rem 2rem;
  }
  .col-scroll::-webkit-scrollbar { width: 5px; }
  .col-scroll::-webkit-scrollbar-track { background: transparent; }
  .col-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .col-scroll::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }
  .col-footer {
    padding: 1rem 2rem; border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  /* ── Right: log ── */
  .col-right {
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--bg);
  }
  .log-bar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 1.5rem 2rem 1.25rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .log-bar-title {
    font-family: var(--mono); font-size: 0.8rem; font-weight: 600;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em;
  }
  .log-actions { display: flex; gap: 0.4rem; }
  .log-body {
    flex: 1; overflow-y: auto; padding: 0.75rem 0;
    font-family: var(--mono); font-size: 0.85rem; line-height: 1.9;
  }
  .log-body::-webkit-scrollbar { width: 5px; }
  .log-body::-webkit-scrollbar-track { background: transparent; }
  .log-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  .log-line { padding: 0.15rem 2rem; transition: background var(--transition); }
  .log-line:hover { background: rgba(0,0,0,0.02); }
  .log-ts { color: var(--text-muted); margin-right: 0.75rem; }
  .log-ok { color: var(--accent); font-weight: 500; }
  .log-fail { color: var(--red); font-weight: 500; }
  .log-info { color: var(--text-secondary); }
  .log-step { color: var(--amber); font-weight: 600; }
  .log-empty {
    color: var(--text-muted); height: 100%; display: flex;
    align-items: center; justify-content: center;
    font-family: var(--font); font-size: 0.95rem; opacity: 0.5;
  }

  /* ── Auth overlay ── */
  .auth-overlay {
    position: fixed; inset: 0; background: var(--bg);
    display: flex; align-items: center; justify-content: center; z-index: 10;
  }
  .auth-box {
    width: 380px; background: var(--surface);
    padding: 2.5rem; border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md); border: 1px solid var(--border);
  }
  .auth-box .auth-heading {
    font-size: 1.35rem; font-weight: 700; color: var(--text);
    letter-spacing: -0.02em; margin-bottom: 1.5rem;
  }

  /* ── Section labels ── */
  .section {
    font-family: var(--mono); font-size: 0.75rem; font-weight: 600;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em;
    margin-top: 2rem; margin-bottom: 0.6rem;
  }
  .section:first-child { margin-top: 0; }

  /* ── Fields ── */
  .f { margin-top: 0.75rem; }
  .f:first-child { margin-top: 0; }
  .f label {
    display: block; font-size: 0.875rem; font-weight: 500;
    color: var(--text-secondary); margin-bottom: 0.35rem;
  }
  .f input {
    width: 100%; padding: 0.6rem 0.85rem; font-family: var(--mono);
    font-size: 0.875rem; color: var(--text); background: var(--surface-alt);
    border: 1px solid var(--border); border-radius: var(--radius);
    transition: all var(--transition); outline: none;
  }
  .f input:hover { border-color: var(--border-hover); }
  .f input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--accent-subtle);
    background: var(--surface);
  }
  .f input::placeholder { color: var(--text-muted); font-weight: 400; }

  .sep { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }

  /* ── Buttons ── */
  button {
    font-family: var(--font); font-size: 0.875rem; font-weight: 600;
    padding: 0.55rem 1.1rem; border: none; border-radius: var(--radius);
    cursor: pointer; transition: all var(--transition); outline: none;
  }
  button:active { transform: translateY(1px) scale(0.98); }
  button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  .btn-primary { background: var(--accent); color: #ffffff; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-ghost {
    background: transparent; color: var(--text-secondary);
    border: 1px solid var(--border);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--surface-alt); color: var(--text);
    border-color: var(--border-hover);
  }
  .btn-test {
    background: var(--amber-subtle); color: var(--amber);
    border: 1px solid rgba(217,119,6,0.15);
  }
  .btn-test:hover:not(:disabled) {
    background: rgba(217,119,6,0.12);
    border-color: rgba(217,119,6,0.3);
  }
  .btn-sm { font-size: 0.8rem; padding: 0.35rem 0.7rem; }

  .toast {
    padding: 0.5rem 0.85rem; border-radius: var(--radius);
    margin-top: 0.6rem; font-size: 0.85rem; font-weight: 500;
  }
  .toast.ok {
    background: var(--accent-subtle); color: var(--accent);
    border: 1px solid rgba(16,185,129,0.15);
  }
  .toast.err {
    background: var(--red-subtle); color: var(--red);
    border: 1px solid rgba(220,38,38,0.15);
  }
  .hint {
    font-size: 0.8rem; color: var(--text-muted); margin-top: 0.4rem;
    line-height: 1.5;
  }
  .actions { display: flex; gap: 0.6rem; align-items: center; }

  /* ── Mobile: stack ── */
  @media (max-width: 768px) {
    html, body { overflow: auto; }
    .layout { grid-template-columns: 1fr; height: auto; min-height: 100dvh; }
    .col-left { border-right: none; border-bottom: 1px solid var(--border); }
    .col-scroll { overflow: visible; }
    .col-right { min-height: 300px; }
    .col-header, .log-bar { padding: 1.25rem 1.25rem 1rem; }
    .col-scroll { padding: 1.25rem; }
    .col-footer { padding: 1rem 1.25rem; }
    .log-line { padding: 0.15rem 1.25rem; }
  }
</style>
</head>
<body>

<!-- Auth overlay -->
<div id="auth-overlay" class="auth-overlay" style="display:none">
  <div class="auth-box">
    <div class="auth-heading" id="auth-title">Login</div>
    <div class="f"><label>帳號</label><input id="auth-user" autocomplete="username" placeholder="admin"></div>
    <div class="f"><label>密碼</label><input id="auth-pass" type="password" autocomplete="current-password"></div>
    <div style="margin-top:1.25rem"><button class="btn-primary" onclick="doAuth()">確認</button></div>
    <div id="auth-msg"></div>
  </div>
</div>

<!-- Main two-column layout -->
<div class="layout" id="main-layout" style="display:none">
  <div class="col-left">
    <div class="col-header">
      <h1>banini-tracker <span class="tag">config</span></h1>
      <button class="btn-ghost btn-sm" onclick="doLogout()">登出</button>
    </div>
    <div class="col-scroll">
      <div class="section">必填</div>
      <div class="f"><label>Apify Token</label><input id="cfg-APIFY_TOKEN" placeholder="apify_api_..."></div>
      <div class="f"><label>LLM API Key</label><input id="cfg-LLM_API_KEY" placeholder="sk-..."></div>
      <hr class="sep">
      <div class="section">Telegram</div>
      <div class="f"><label>Bot Token</label><input id="cfg-TG_BOT_TOKEN" placeholder="110201543:AAHdqT..."></div>
      <div class="f"><label>Channel ID</label><input id="cfg-TG_CHANNEL_ID" placeholder="-100..."></div>
      <hr class="sep">
      <div class="section">Discord</div>
      <div class="f"><label>Bot Token</label><input id="cfg-DISCORD_BOT_TOKEN"></div>
      <div class="f"><label>Channel ID</label><input id="cfg-DISCORD_CHANNEL_ID"></div>
      <hr class="sep">
      <div class="section">LINE</div>
      <div class="f"><label>Channel Access Token</label><input id="cfg-LINE_CHANNEL_ACCESS_TOKEN"></div>
      <div class="f"><label>To</label><input id="cfg-LINE_TO" placeholder="userId / groupId"></div>
      <hr class="sep">
      <div class="section">進階</div>
      <div class="f"><label>LLM Base URL</label><input id="cfg-LLM_BASE_URL"></div>
      <div class="f"><label>LLM Model</label><input id="cfg-LLM_MODEL"></div>
      <div class="f"><label>Transcriber</label><input id="cfg-TRANSCRIBER" placeholder="noop / groq"></div>
      <div class="f"><label>Groq API Key</label><input id="cfg-GROQ_API_KEY"></div>
      <div class="f"><label>FinMind Token</label><input id="cfg-FINMIND_TOKEN"></div>
      <p class="hint">Base URL 預設 DeepInfra / Model 預設 MiniMax-M2.5</p>
    </div>
    <div class="col-footer">
      <div class="actions">
        <button class="btn-primary" onclick="saveConfig()">儲存</button>
        <button class="btn-test" id="test-btn" onclick="runTest()">測試連線</button>
      </div>
      <div id="config-msg"></div>
    </div>
  </div>

  <div class="col-right">
    <div class="log-bar">
      <span class="log-bar-title">Log</span>
      <div class="log-actions">
        <button class="btn-ghost btn-sm" onclick="clearLog()">清除</button>
        <button class="btn-ghost btn-sm" id="copy-btn" onclick="copyLog()">複製</button>
      </div>
    </div>
    <div class="log-body" id="log-body">
      <div class="log-empty">等待操作</div>
    </div>
  </div>
</div>

<script>
let configKeys = [];
let originalValues = {};
let isSetup = false;
let logLines = [];
const $ = id => document.getElementById(id);
function ts() { return new Date().toLocaleTimeString('zh-TW', { hour12: false }); }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function appendLog(text, type) {
  const body = $('log-body');
  const empty = body.querySelector('.log-empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = 'log-line';
  const t = ts();
  const cls = { ok:'log-ok', fail:'log-fail', step:'log-step', info:'log-info' }[type] || 'log-info';
  el.innerHTML = '<span class="log-ts">' + t + '</span><span class="' + cls + '">' + esc(text) + '</span>';
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  logLines.push('[' + t + '] ' + text);
}

function clearLog() {
  $('log-body').innerHTML = '<div class="log-empty">等待操作</div>';
  logLines = [];
}

async function copyLog() {
  try {
    await navigator.clipboard.writeText(logLines.join('\\n'));
    const b = $('copy-btn'); b.textContent = '已複製';
    setTimeout(() => { b.textContent = '複製'; }, 1200);
  } catch {}
}

async function init() {
  const res = await fetch('/api/status');
  const { initialized } = await res.json();
  if (!initialized) {
    isSetup = true;
    $('auth-title').textContent = '建立管理員帳號';
    $('auth-overlay').style.display = 'flex';
    return;
  }
  const cfgRes = await fetch('/api/config');
  if (cfgRes.status === 401) {
    $('auth-title').textContent = '登入';
    $('auth-overlay').style.display = 'flex';
    return;
  }
  $('main-layout').style.display = 'grid';
  showConfig(await cfgRes.json());
}

async function doAuth() {
  const user = $('auth-user').value, pass = $('auth-pass').value;
  const url = isSetup ? '/api/setup' : '/api/login';
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:user,password:pass}) });
  const data = await res.json();
  if (!res.ok) { toast('auth-msg', data.error, true); return; }
  $('auth-overlay').style.display = 'none';
  $('main-layout').style.display = 'grid';
  appendLog(isSetup ? '管理員帳號已建立' : '登入成功', 'ok');
  const cfgRes = await fetch('/api/config');
  showConfig(await cfgRes.json());
}

function showConfig(data) {
  configKeys = data.keys || [];
  originalValues = {};
  for (const key of configKeys) {
    const el = $('cfg-' + key);
    const val = data.config[key] || '';
    if (el) el.value = val;
    originalValues[key] = val;
  }
}

async function saveConfig() {
  const body = {}; let n = 0;
  for (const key of configKeys) {
    const el = $('cfg-' + key);
    const val = el ? el.value.trim() : '';
    if (val !== originalValues[key]) { body[key] = val; n++; }
  }
  if (!n) { appendLog('沒有變更', 'info'); toast('config-msg','沒有變更',false); return; }
  appendLog('儲存 ' + n + ' 項變更...', 'step');
  const res = await fetch('/api/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { appendLog('儲存失敗：' + data.error, 'fail'); toast('config-msg', data.error, true); return; }
  appendLog('設定已儲存', 'ok');
  toast('config-msg', '已儲存，下次排程生效', false);
  const cfgRes = await fetch('/api/config');
  if (cfgRes.ok) showConfig(await cfgRes.json());
}

async function runTest() {
  const btn = $('test-btn');
  btn.disabled = true; btn.textContent = '執行中...';
  const labels = { config:'設定檢查', fetch:'抓取貼文', analyze:'AI 分析', notify:'通知推送', done:'完成' };
  appendLog('-- 連線測試 --', 'step');
  try {
    const res = await fetch('/api/test');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\\n');
      buf = parts.pop() || '';
      for (const ln of parts) {
        if (!ln.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(ln.slice(6));
          const lbl = labels[ev.step] || ev.step;
          if (ev.status === 'info') appendLog(lbl + ' ' + ev.detail, 'info');
          else if (ev.status === 'ok') appendLog('[OK] ' + lbl + ' ' + ev.detail, 'ok');
          else appendLog('[FAIL] ' + lbl + ' ' + ev.detail, 'fail');
        } catch {}
      }
    }
  } catch (err) { appendLog('請求失敗：' + err.message, 'fail'); }
  appendLog('-- 測試結束 --', 'step');
  btn.disabled = false; btn.textContent = '測試連線';
}

async function doLogout() {
  await fetch('/api/logout', { method:'POST' });
  $('main-layout').style.display = 'none';
  $('auth-title').textContent = '登入';
  $('auth-overlay').style.display = 'flex';
  appendLog('已登出', 'info');
}

function toast(id, text, isErr) {
  const el = $(id);
  el.className = 'toast ' + (isErr ? 'err' : 'ok');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

init();
</script>
</body>
</html>`;
