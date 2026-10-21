// GATE TEMPORAL: valida que el celular resuelve la URL de audio con NewPipe y que
// esa URL responde (bytes de audio). Se borra cuando el reproductor nativo esté listo.
import { Platform } from 'react-native';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';

export async function gateNewPipe(videoId = '69RdQFDuYPI'): Promise<string> {
  if (Platform.OS !== 'android') return 'Gate: solo Android';
  const r = await QpAudio.resolveAudio(videoId);
  const res = await fetch(r.url, {
    headers: { Range: 'bytes=0-1023', 'User-Agent': r.userAgent },
  });
  const buf = await res.arrayBuffer();
  return `${r.title}\n${r.mime} ${Math.round(r.bitrate / 1000)} kbps\nHTTP ${res.status}, ${buf.byteLength} bytes`;
}
