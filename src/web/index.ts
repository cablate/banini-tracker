/**
 * Web config panel: Hono server with auth + config CRUD.
 * Single HTML page, no build step.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { registerApiRoutes } from './routes/api.js';
import { registerPageRoutes } from './routes/pages.js';

export const app = new Hono();

registerApiRoutes(app);
registerPageRoutes(app);

const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);

export function startWebServer(): void {
  serve({ fetch: app.fetch, port: WEB_PORT }, () => {
    console.log(`[Web] 設定頁面已啟動: http://localhost:${WEB_PORT}`);
  });
}
