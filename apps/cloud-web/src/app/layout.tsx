import '../../../../packages/ui/brand/tokens.css';
import '../../../../packages/ui/brand/fonts.css';
import '../../../../packages/ui/brand/components.css';
import './globals.css';
import type { ReactNode } from 'react';
export const metadata={title:'MEKONIQ · Vận hành nhà hàng',description:'Intelligence in Motion.',icons:{icon:'/brand/assets/MEKONIQ_Icon_Transparent.svg'}};
export default function Layout({children}: {children: ReactNode}) {
  return <html lang="vi"><body className="cloud-app mq-theme">{children}</body></html>;
}
