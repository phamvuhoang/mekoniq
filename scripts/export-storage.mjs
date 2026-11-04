#!/usr/bin/env node
// Writes the Storage object manifest (bucket, path, size, sha256 from asset_manifest) and, with --copy, downloads each object next to it. Storage files are NOT part of a database dump.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
/** objects: rows of asset_manifest; download(bucket, path) -> Buffer. Returns the manifest section and writes copies when `outDir` is given. */
export async function exportStorage({ objects, download, outDir }) {
  const out = [];
  for (const o of objects) {
    const entry = { bucket: o.bucket, path: o.object_path, bytes: Number(o.size_bytes), sha256: o.sha256, copied: false };
    if (download && outDir) {
      const bytes = await download(o.bucket, o.object_path);
      if (createHash('sha256').update(bytes).digest('hex') !== o.sha256) throw new Error(`STORAGE_OBJECT_HASH_MISMATCH ${o.object_path}`); // never put a damaged copy in a backup
      const target = join(outDir, 'storage', o.object_path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); entry.copied = true;
    }
    out.push(entry);
  }
  return { objects: out };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL; if (!url) { console.error('DATABASE_ADMIN_URL required'); process.exit(2); }
  const sql = postgres(url, { max: 1 });
  try { const objects = await sql`SELECT bucket, object_path, size_bytes, sha256 FROM public.asset_manifest WHERE status = 'ready'`; console.log(JSON.stringify(await exportStorage({ objects }), null, 1)); } finally { await sql.end(); }
}
