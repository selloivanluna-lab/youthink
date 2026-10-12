// Configuración de entorno (variables EXPO_PUBLIC_*).
// API_URL: backend Fly.io. QP_TOKEN: token compartido app<->backend.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://quepensabas-bajar-api.fly.dev').replace(/\/+$/, '');
export const QP_TOKEN = process.env.EXPO_PUBLIC_QP_TOKEN || '';

// Supabase (mismo proyecto que el resto del ecosistema)
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Gemini (Info IA). Acceso estático: Metro inlina solo `process.env.EXPO_PUBLIC_*` literal.
export const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_KEY || '';
