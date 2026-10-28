/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** The local posting tool's server, set only by `bun run note-tweets`. */
  readonly VITE_TWEET_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
