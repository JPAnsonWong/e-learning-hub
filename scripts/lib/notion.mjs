// Notion REST 小工具：限速（約每秒 3 次）、重試、分頁讀取子區塊，以及讀取本機 .env.local。
// 本機執行的 Notion 腳本（notion-inspect / notion-setup-daily）共用；token 只從環境變數或 .env.local 讀，不會被印出。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 讀取專案根目錄的 .env.local（已在 .gitignore），格式：KEY=value，# 開頭為註解
export function loadEnvLocal(root) {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// 從網址或純 ID 取出 32 位的 Notion 頁面 ID
export function pageIdFrom(s) {
  const m = String(s || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : '';
}

export function createNotion({ token, base = process.env.NOTION_API_BASE || 'https://api.notion.com/v1', delayMs = 350 }) {
  if (!token) throw new Error('缺少 NOTION_TOKEN（請放在 .env.local，不要提交）');
  let last = 0;
  async function call(method, path, body, attempt = 0) {
    const wait = delayMs - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const ra = Number(res.headers.get('retry-after')) || 2 ** attempt;
      await new Promise((r) => setTimeout(r, ra * 1000));
      return call(method, path, body, attempt + 1);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(`Notion ${method} ${path.split('?')[0]} → ${res.status} ${json.message || ''}`);
      e.status = res.status;
      throw e;
    }
    return json;
  }
  async function listChildren(blockId) {
    const out = [];
    let cursor;
    do {
      const r = await call('GET', `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
      out.push(...r.results);
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
    return out;
  }
  // 遍歷頁面底下（最多 depth 層子頁面）的所有資料庫，回傳 [{title, id, path}]；只讀區塊清單，不讀任何資料列
  async function findDatabases(rootId, depth = 2, trail = []) {
    const found = [];
    for (const b of await listChildren(rootId)) {
      if (b.type === 'child_database') found.push({ title: b.child_database.title, id: b.id, path: trail });
      else if (b.type === 'child_page' && depth > 0) found.push(...await findDatabases(b.id, depth - 1, [...trail, b.child_page.title]));
    }
    return found;
  }
  return { call, listChildren, findDatabases };
}
