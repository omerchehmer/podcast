import type { Api } from "./types";
import { SupabaseApi } from "./supabaseApi";
import { MockApi } from "./mockApi";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Live backend when configured; otherwise preview mode with sample data. */
export const api: Api = url && key ? new SupabaseApi(url, key) : new MockApi();
export * from "./types";
