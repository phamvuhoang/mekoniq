#!/usr/bin/env node
// Runs a load profile and writes its measured artifact under .lab/load/. Only local test endpoints are ever used (the lab and the local Supabase on 57422); there is no flag for a hosted target.
import { spawnSync } from 'node:child_process';
const profile = process.argv.includes('--free') ? 'tests/load/supabase-free.ts' : 'tests/load/restaurant.ts';
const result = spawnSync(process.execPath, ['--import', 'tsx', profile], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
