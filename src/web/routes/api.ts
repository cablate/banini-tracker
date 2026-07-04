import type { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { isInitialized, setupAdmin, login, logout, validateSession } from '../../auth.js';
import { getAllConfig, setConfigs, getConfigKeys, getConfig, type ConfigKey } from '../../config-store.js';
import { fetchFacebookPosts } from '../../sources/facebook.js';
import { getRecentRuns, getRecentNotifications } from '../../run-logger.js';
import { analyzePosts, DEFAULT_SYSTEM_PROMPT } from '../../analyze.js';
import { createNotifiers, type ReportData, type PostSummary } from '../../notifiers/index.js';
import { getPersonaSourceTarget, loadPersona } from '../../persona.js';

export function registerApiRoutes(app: Hono): void {
  const isProduction = process.env.NODE_ENV === 'production';

  const requireAuth: MiddlewareHandler = async (c, next) => {
    const token = getCookie(c, 'session');
    if (!token || !validateSession(token)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };

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
    if (!masked['SYSTEM_PROMPT']) {
      masked['SYSTEM_PROMPT'] = DEFAULT_SYSTEM_PROMPT;
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

  app.get('/api/runs', requireAuth, (c) => {
    const runs = getRecentRuns(50);
    return c.json({ runs });
  });

  app.get('/api/notifications', requireAuth, (c) => {
    const notifications = getRecentNotifications(100);
    return c.json({ notifications });
  });

  app.get('/api/default-prompt', requireAuth, (c) => {
    return c.json({ prompt: DEFAULT_SYSTEM_PROMPT });
  });

  app.get('/api/test', requireAuth, (c) => {
    return streamSSE(c, async (stream) => {
      const send = async (step: string, status: 'ok' | 'fail' | 'info', detail: string) => {
        await stream.writeSSE({ data: JSON.stringify({ step, status, detail }) });
      };

      const apifyToken = getConfig('APIFY_TOKEN');
      const llmApiKey = getConfig('LLM_API_KEY');
      if (!apifyToken) { await send('config', 'fail', 'APIFY_TOKEN 未設定'); return; }
      if (!llmApiKey) { await send('config', 'fail', 'LLM_API_KEY 未設定'); return; }
      await send('config', 'ok', '設定檢查通過');

      const persona = loadPersona();
      let post: any;
      try {
        await send('fetch', 'info', '正在抓取貼文...');
        const posts = await fetchFacebookPosts(getPersonaSourceTarget(persona, 'facebook'), apifyToken, 1);
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
          persona,
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
      await send('notify', 'info', `正在推送至 ${notifiers.map((n) => n.name).join(', ')}...`);
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
}
