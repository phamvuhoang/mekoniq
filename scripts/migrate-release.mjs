#!/usr/bin/env node
// Migration planning guard for expand/contract releases. A migration that removes or rewrites something old clients still read or write is DESTRUCTIVE and is refused unless every client is
// known and nothing is waiting in a journal. Usage: node scripts/migrate-release.mjs --plan [dir]   (exit 1 when a destructive migration is present without clearance)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/** Plan function: backward compatible migrations always go; destructive ones only when no client is unknown and no journal is pending. */
export function migrationAllowed(s) { return s.backwardCompatible || (s.unknownClients === 0 && s.pendingJournals === 0); }
const DESTRUCTIVE = [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bALTER\s+TABLE\s+(IF\s+EXISTS\s+)?\S+\s+DROP\s+(?!CONSTRAINT\b|COLUMN\b)\w+/i, /\bDROP\s+(FUNCTION|TYPE|VIEW|SCHEMA)\b/i, /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i];
export function classifyMigration(text) {
  const body = text.replace(/--.*$/gm, '');
  const destructive = DESTRUCTIVE.filter(r => r.test(body)).map(r => r.source);
  return { backwardCompatible: destructive.length === 0, destructive, constraintChanges: /\bDROP\s+CONSTRAINT\b/i.test(body) };
}
export function planMigrations(dir = 'supabase/migrations') {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(file => ({ file, ...classifyMigration(readFileSync(join(dir, file), 'utf8')) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = planMigrations(process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]));
  let blocked = 0;
  for (const m of plan) { console.log(`${m.backwardCompatible ? 'expand ' : 'DESTRUCTIVE'} ${m.file}${m.constraintChanges ? ' (changes constraints)' : ''}`); if (!m.backwardCompatible) blocked++; }
  if (blocked && !process.argv.includes('--clearance')) { console.error(`${blocked} destructive migration(s): needs --clearance with proof that no client is unknown and no journal is pending`); process.exit(1); }
}
