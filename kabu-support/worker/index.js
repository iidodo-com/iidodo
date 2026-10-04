// Cloudflare Worker: ブラウザ(CORS)から Yahoo の株価データを取得するための中継
// GET /api/stock?code=7203  → { code, name, daily, intra, margin, ... }
import { fetchStock } from '../lib/yahoo.mjs';

export default {
  async fetch(req, env = {}) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const u = new URL(req.url);
    if (u.pathname !== '/api/stock') return new Response('not found', { status: 404, headers: cors });
    const code = (u.searchParams.get('code') || '').toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(code)) return new Response(JSON.stringify({ error: 'invalid code' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    try {
      const body = JSON.stringify(await fetchStock(code));
      return new Response(body, { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message) }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  },
};
