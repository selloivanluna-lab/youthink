import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

const dummySupabase: any = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithOAuth: async () => ({ error: new Error('Supabase no inicializado') }),
    signOut: async () => ({ error: null }),
  },
  from: () => ({
    select: () => ({ order: () => Promise.resolve({ data: [], error: null }), eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    upsert: () => Promise.resolve({ error: null }),
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }),
};

let client: any;
try {
  const key = SUPABASE_ANON_KEY || 'sb_publishable_BeiQBv-HywDeWRd_ydBx_g_K1ZbCRV4';
  const url = SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';
  client = createClient(url, key, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
} catch (e) {
  console.warn('Error al inicializar Supabase:', e);
  client = dummySupabase;
}

export const supabase = client;
