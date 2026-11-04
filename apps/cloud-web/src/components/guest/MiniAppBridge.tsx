'use client';
/**
 * Zalo Mini App bridge. It loads nothing and calls nothing until a real Zalo app registration is supplied (NEXT_PUBLIC_ZALO_APP_ID) AND the `zalo-mini-app` profile is approved
 * (docs/integrations/channel-acceptance.md). Until then it only says so; the sandbox web checkout (/order/<venue>) is the only online ordering page.
 */
export function MiniAppBridge(){
 if(!process.env.NEXT_PUBLIC_ZALO_APP_ID)return <p role="status">Zalo Mini App chưa được cấu hình. / The Zalo Mini App is not configured.</p>;
 return <p role="status">Zalo Mini App cần hồ sơ tích hợp đã được duyệt trước khi đặt món. / The Zalo Mini App needs an approved integration profile before it can take orders.</p>;
}
