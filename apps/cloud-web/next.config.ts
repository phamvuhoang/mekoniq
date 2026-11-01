import type { NextConfig } from 'next';
// The table token is the guest's credential and sits in the URL: never leak it in a Referer or keep it in a cache.
const guestHeaders = [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }];
const config: NextConfig = {
  transpilePackages: ['@mekoniq/contracts', '@mekoniq/domain', '@mekoniq/sync'],
  headers: () => [{ source: '/table/:token', headers: guestHeaders }],
};
export default config;
