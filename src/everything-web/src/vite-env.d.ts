/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** "1" turns on the review tools, which only local review servers set. */
  readonly VITE_CN_REVIEW_TOOLS?: string;
  /** "1" makes an extension's content scripts send database requests through
   *  the background. Only the local-rerun extension build sets it. */
  readonly VITE_CN_RELAY_DB_FETCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
