/**
 * F.S. Editor cloud API.
 *
 * Accounts live in Supabase Auth; this Worker checks the Supabase access token and keeps each
 * user's data in R2 under `users/<user id>/`:
 *   projects/<project id>.json   project edit (JSON, small)
 *   media/<media id>             original media files (large; uploaded/downloaded straight to/from
 *                                R2 with short-lived presigned URLs, so they never pass through here)
 */
import { AwsClient } from 'aws4fetch';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';

export interface Env {
  BUCKET: R2Bucket;
  SUPABASE_URL: string;
  /** Supabase anon/publishable key (public). Used to check tokens of projects on the legacy HS256 secret. */
  SUPABASE_ANON_KEY?: string;
  R2_BUCKET: string;
  QUOTA_GB: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SUPABASE_JWT_SECRET?: string;
  /** Optional S3 endpoint override (local testing). Default: https://<account>.r2.cloudflarestorage.com */
  R2_ENDPOINT?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const fail = (status: number, error: string) => json({ error }, status);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
const URL_TTL = 6 * 3600;

/* ---------------- auth ---------------- */

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

async function userId(req: Request, env: Env): Promise<string | null> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return null;
  const token = m[1];
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const opts = { issuer: `${base}/auth/v1`, audience: 'authenticated' };
  try {
    let payload: JWTPayload;
    if (decodeProtectedHeader(token).alg === 'HS256') {
      if (env.SUPABASE_JWT_SECRET) payload = (await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), opts)).payload;
      else {
        // Legacy shared-secret project without the secret configured: ask Supabase who this is.
        const r = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY ?? '' } });
        if (!r.ok) return null;
        payload = { sub: ((await r.json()) as { id?: string }).id };
      }
    } else {
      const url = `${base}/auth/v1/.well-known/jwks.json`;
      if (jwks?.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url)) };
      payload = (await jwtVerify(token, jwks.set, opts)).payload;
    }
    return typeof payload.sub === 'string' && ID.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/* ---------------- R2 helpers ---------------- */

async function listAll(env: Env, prefix: string): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, include: ['customMetadata'] });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const usedBytes = async (env: Env, uid: string) => (await listAll(env, `users/${uid}/`)).reduce((n, o) => n + o.size, 0);

async function presign(env: Env, key: string, method: 'GET' | 'PUT'): Promise<string> {
  const aws = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const url = new URL(`${endpoint.replace(/\/+$/, '')}/${env.R2_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(URL_TTL));
  const signed = await aws.sign(new Request(url, { method }), { aws: { signQuery: true } });
  return signed.url;
}

interface ProjectLike {
  id?: string;
  name?: string;
  width?: number;
  height?: number;
  fps?: number;
  updatedAt?: number;
  clips?: unknown[];
  media?: { id: string; size?: number }[];
}

/* ---------------- routes ---------------- */

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, service: 'fs-editor-cloud' });

  const uid = await userId(req, env);
  if (!uid) return fail(401, 'Not signed in');
  const root = `users/${uid}/`;
  const quota = Number(env.QUOTA_GB || '50') * 1024 ** 3;
  const parts = url.pathname.split('/').filter(Boolean);

  // GET /v1/me
  if (parts[0] === 'v1' && parts[1] === 'me' && req.method === 'GET') {
    return json({ id: uid, usedBytes: await usedBytes(env, uid), quotaBytes: quota });
  }

  // /v1/projects[/<id>]
  if (parts[0] === 'v1' && parts[1] === 'projects') {
    const id = parts[2];
    if (!id) {
      if (req.method !== 'GET') return fail(405, 'Method not allowed');
      const objs = await listAll(env, `${root}projects/`);
      const list = objs.map((o) => {
        const m = o.customMetadata ?? {};
        return {
          id: o.key.slice(`${root}projects/`.length).replace(/\.json$/, ''),
          name: m.name ?? 'Untitled',
          width: Number(m.width) || 0,
          height: Number(m.height) || 0,
          fps: Number(m.fps) || 0,
          clips: Number(m.clips) || 0,
          media: Number(m.media) || 0,
          mediaBytes: Number(m.mediaBytes) || 0,
          updatedAt: Number(m.updatedAt) || o.uploaded.getTime(),
        };
      });
      return json(list.sort((a, b) => b.updatedAt - a.updatedAt));
    }
    if (!ID.test(id)) return fail(400, 'Bad project id');
    const key = `${root}projects/${id}.json`;

    if (req.method === 'GET') {
      const obj = await env.BUCKET.get(key);
      if (!obj) return fail(404, 'Project not found');
      return new Response(obj.body, { headers: { 'Content-Type': 'application/json', ...CORS } });
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_PROJECT_BYTES) return fail(413, 'Project file too large');
      let p: ProjectLike;
      try {
        p = JSON.parse(text);
      } catch {
        return fail(400, 'Invalid JSON');
      }
      if (p.id !== id || !Array.isArray(p.clips) || !Array.isArray(p.media)) return fail(400, 'Not an F.S. Editor project');
      await env.BUCKET.put(key, text, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          name: String(p.name ?? 'Untitled').slice(0, 200),
          width: String(p.width ?? 0),
          height: String(p.height ?? 0),
          fps: String(p.fps ?? 0),
          clips: String(p.clips.length),
          media: String(p.media.length),
          mediaBytes: String(p.media.reduce((n, m) => n + (Number(m.size) || 0), 0)),
          updatedAt: String(p.updatedAt ?? Date.now()),
        },
      });
      return json({ ok: true });
    }
    if (req.method === 'DELETE') {
      await env.BUCKET.delete(key);
      // Drop media no other cloud project still uses.
      const keep = new Set<string>();
      for (const o of await listAll(env, `${root}projects/`)) {
        const body = await env.BUCKET.get(o.key);
        if (!body) continue;
        try {
          for (const m of ((await body.json()) as ProjectLike).media ?? []) keep.add(m.id);
        } catch {
          /* skip unreadable */
        }
      }
      const orphans = (await listAll(env, `${root}media/`)).map((o) => o.key).filter((k) => !keep.has(k.slice(`${root}media/`.length)));
      for (let i = 0; i < orphans.length; i += 1000) await env.BUCKET.delete(orphans.slice(i, i + 1000));
      return json({ ok: true, freedFiles: orphans.length });
    }
    return fail(405, 'Method not allowed');
  }

  // POST /v1/media/upload {items:[{id,size}]} → which are missing + presigned PUT urls for them
  // POST /v1/media/download {ids:[...]}      → presigned GET urls
  if (parts[0] === 'v1' && parts[1] === 'media' && req.method === 'POST') {
    let body: { items?: { id: string; size: number }[]; ids?: string[] };
    try {
      body = await req.json();
    } catch {
      return fail(400, 'Invalid JSON');
    }
    if (parts[2] === 'upload') {
      const items = (body.items ?? []).filter((x) => ID.test(x.id));
      const out: { id: string; exists: boolean; url?: string }[] = [];
      let incoming = 0;
      for (const it of items) {
        const head = await env.BUCKET.head(`${root}media/${it.id}`);
        if (head && head.size === it.size) out.push({ id: it.id, exists: true });
        else {
          incoming += Math.max(0, Number(it.size) || 0);
          out.push({ id: it.id, exists: false });
        }
      }
      if (incoming) {
        const used = await usedBytes(env, uid);
        if (used + incoming > quota)
          return fail(413, `Cloud storage full: ${(used / 1024 ** 3).toFixed(1)} GB used of ${(quota / 1024 ** 3).toFixed(0)} GB`);
      }
      for (const o of out) if (!o.exists) o.url = await presign(env, `${root}media/${o.id}`, 'PUT');
      return json({ items: out });
    }
    if (parts[2] === 'download') {
      const ids = (body.ids ?? []).filter((x) => ID.test(x));
      const out: { id: string; url: string | null; size: number }[] = [];
      for (const id of ids) {
        const head = await env.BUCKET.head(`${root}media/${id}`);
        out.push({ id, url: head ? await presign(env, `${root}media/${id}`, 'GET') : null, size: head?.size ?? 0 });
      }
      return json({ items: out });
    }
  }

  return fail(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handle(req, env);
    } catch (e) {
      console.error(e);
      return fail(500, 'Server error');
    }
  },
};
