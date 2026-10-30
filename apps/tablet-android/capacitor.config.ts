import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'io.mekoniq.tablet', appName: 'MEKONIQ', loggingBehavior:'none', webDir: '../tablet-web/dist',
  server: { androidScheme: 'https' }, android: { allowMixedContent: false },
};
export default config;
