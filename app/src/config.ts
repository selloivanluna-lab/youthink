// Configuración de entorno (variables EXPO_PUBLIC_*).
// API_URL: backend Fly.io. QP_TOKEN: token compartido app<->backend.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://quepensabas-bajar-api.fly.dev').replace(/\/+$/, '');
export const QP_TOKEN = process.env.EXPO_PUBLIC_QP_TOKEN || '';

// Supabase (mismo proyecto que el resto del ecosistema)
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
