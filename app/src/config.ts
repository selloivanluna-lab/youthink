// Configuración de entorno (variables EXPO_PUBLIC_*).
// API_URL: backend Fly.io / Render. QP_TOKEN: token compartido app<->backend.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://youthink-1.onrender.com').replace(/\/+$/, '');
export const QP_TOKEN = process.env.EXPO_PUBLIC_QP_TOKEN || '7a5df9bf6747453fa4a97c9b55a62145';

// Supabase (mismo proyecto que el resto del ecosistema)
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_BeiQBv-HywDeWRd_ydBx_g_K1ZbCRV4';

// Gemini (Info IA). Acceso estático: Metro inlina solo `process.env.EXPO_PUBLIC_*` literal.
export const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_KEY || '';
