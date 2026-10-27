import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

const dummySupabase: any = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithOAuth: async () => ({ error: new Error('Supabase no inicializado') }),
    signOut: async () => ({ error: null }),
    setSession: async () => ({ data: {}, error: null }),
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
  // En web (navegador): detectSessionInUrl=true para capturar el hash #access_token=...
  // que Supabase pone en la URL luego del redirect OAuth (necesario en iPhone Safari).
  // En nativo (Android): false porque usamos deep links youthink://
  const isWeb = Platform.OS === 'web';
  client = createClient(url, key, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: isWeb,
    },
  });
} catch (e) {
  console.warn('Error al inicializar Supabase:', e);
  client = dummySupabase;
}

export const supabase = client;
