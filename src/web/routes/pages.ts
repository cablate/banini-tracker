import type { Hono } from 'hono';
import { FRONTEND_HTML } from '../views.js';

export function registerPageRoutes(app: Hono): void {
  app.get('/', (c) => {
    return c.html(FRONTEND_HTML);
  });
}
