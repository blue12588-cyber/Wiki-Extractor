// Static export configuration for Tauri shell.
// prerender=true: every route is emitted as an HTML file at build time (no SSR needed inside Tauri).
// ssr=false: this app runs entirely in the WebView; SSR would only complicate hydration without benefit.
// trailingSlash='ignore': keeps URLs stable when the webview opens index.html directly via tauri://localhost.
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'ignore';
