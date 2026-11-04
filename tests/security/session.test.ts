import { afterAll, beforeAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupWave02 } from '../support/wave02-db';
import { createSupabaseActor } from '../support/supabase-auth';
import { dispatchRequest } from '../../apps/cloud-web/src/server/route-registry';
import { registerWave02Routes, type CloudRoute } from '../../apps/cloud-web/src/server/modules/routes';
let db: Awaited<ReturnType<typeof setupWave02>>, user: Awaited<ReturnType<typeof createSupabaseActor>>;
const scope = { organizationId: 'sess-' + randomUUID(), venueId: 'venue-a' };
const routes: CloudRoute[] = []; registerWave02Routes(r => routes.push(r));
const fill = (path: string) => path.replace(':venueId', scope.venueId).replace(/:[A-Za-z]+/g, 'x');
beforeAll(async () => { db = await setupWave02(); user = await createSupabaseActor(db.admin, scope, 'owner'); });
afterAll(async () => { if (user) await user.cleanup(); if (db) await db.close(); });
test('every protected route refuses a missing, forged or revoked credential with 401 and a code-only body', async () => {
  const protectedRoutes = routes.filter(r => r.permission !== null);
  expect(protectedRoutes.length).toBeGreaterThan(40);
  const bad: string[] = [];
  const temp = await createSupabaseActor(db.admin, scope, 'owner');
  await dispatchRequest(new Request('http://x/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${temp.accessToken}` } })); // revoked
  for (const route of protectedRoutes) for (const auth of [undefined, 'Bearer forged.token.value', `Bearer ${temp.accessToken}`]) {
    const res = await dispatchRequest(new Request('http://x' + fill(route.path), { method: route.method, headers: { ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' }, ...(route.method === 'GET' ? {} : { body: '{}' }) }));
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (res.status !== 401 || !body || Object.keys(body).join() !== 'code') bad.push(`${route.method} ${route.path} ${auth?.slice(0, 14) ?? 'none'} -> ${res.status}`);
  }
  await temp.cleanup();
  expect(bad).toEqual([]);
});
test('cookie-authenticated mutations from a foreign origin are refused (CSRF) on every mutating route', async () => {
  const mutating = routes.filter(r => r.method !== 'GET' && r.permission !== null && r.path.includes(':venueId'));
  expect(mutating.length).toBeGreaterThan(15);
  const bad: string[] = [];
  for (const route of mutating) {
    const res = await dispatchRequest(new Request('http://app.example' + fill(route.path), { method: route.method, headers: { Cookie: `mekoniq_access=${encodeURIComponent(user.accessToken)}`, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' }));
    if (res.status !== 403) bad.push(`${route.method} ${route.path} -> ${res.status}`);
  }
  expect(bad).toEqual([]);
});
test('error responses never carry stack traces, SQL, connection strings or secrets', async () => {
  const seen: string[] = [];
  for (const route of routes.filter(r => r.path.includes(':venueId'))) {
    const res = await dispatchRequest(new Request('http://x' + fill(route.path) + (route.method === 'GET' ? '?kind=%00&businessDate=nope' : ''), { method: route.method, headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' }, ...(route.method === 'GET' ? {} : { body: JSON.stringify({ type: 'x', payload: null, features: 7, snapshot: 1, patch: 1, venues: 'a', items: 'x' }) }) }));
    if (res.status >= 400) seen.push(await res.text());
  }
  expect(seen.length).toBeGreaterThan(25);
  for (const text of seen) { expect(text).not.toMatch(/at \w+ \(|node_modules|SELECT |INSERT |postgres(ql)?:\/\/|password|SUPABASE_|eyJ[A-Za-z0-9_-]{20,}/i); expect(Object.keys(JSON.parse(text)).join()).toBe('code'); }
});
