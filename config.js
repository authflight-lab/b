// Bartender Mini App — PUBLIC configuration only.
// This file is safe to ship to Cloudflare Pages. It must NEVER contain
// secrets, service-role keys, or any game logic. Only the public API base.
window.BT_CONFIG = {
  // Same-origin proxy: empty string => requests go to `/bt/api/...` on THIS
  // origin (app.partygc.online), handled by functions/bt/api/[[path]].js which
  // forwards server-to-server to the backend. This avoids all cross-origin/CORS
  // behaviour in the Telegram webview. Do NOT set an absolute cross-origin URL
  // here or the CORS/webview failure returns.
  BT_API_BASE: ""
};
