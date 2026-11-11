/**
 * Cloud sync settings, baked in at build time (see cloud/README.md).
 * When they're missing, every account/cloud UI is hidden and the app stays fully local.
 */
const env = import.meta.env;

export const CLOUD = {
  supabaseUrl: ((env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/+$/, ''),
  /** Supabase "anon"/publishable key. Public by design; access is enforced by the cloud API. */
  anonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  /** URL of the Cloudflare Worker in cloud/. */
  api: ((env.VITE_CLOUD_API as string | undefined) ?? '').replace(/\/+$/, ''),
};

export const cloudEnabled = !!(CLOUD.supabaseUrl && CLOUD.anonKey && CLOUD.api);
