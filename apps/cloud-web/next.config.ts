import type { NextConfig } from 'next';
const config: NextConfig = { transpilePackages: ['@mekoniq/contracts', '@mekoniq/domain', '@mekoniq/sync'] };
export default config;
