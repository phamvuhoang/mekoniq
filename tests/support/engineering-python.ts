import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Used for portable compiler fixtures and protocol doubles.
const venv = resolve('.venv/bin/python');
export const engineeringPython = process.env.ENGINEERING_PYTHON ?? (existsSync(venv) ? venv : 'python3');
