import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { QpAudioEvents, ResolvedAudio, ResolvedVideo, CastSource, CastSelfTest, CastStats } from './QpAudio.types';

declare class QpAudioModule extends NativeModule<QpAudioEvents> {
  resolveAudio(videoId: string): Promise<ResolvedAudio>;
  resolveVideo(videoId: string): Promise<ResolvedVideo>;
  /** URL local (LAN) que el Chromecast descarga del propio teléfono. */
  castUrl(videoId: string, kind: 'audio' | 'video'): Promise<CastSource>;
  /** Mantiene vivo el proceso/servidor mientras se transmite al TV. */
  castKeepAlive(activo: boolean): Promise<boolean>;
  /** Autoprueba del servidor local (sin TV). */
  castSelfTest(videoId: string, kind: 'audio' | 'video'): Promise<CastSelfTest>;
  /** Cuántas veces el TV pidió el medio (0 = nunca llegó al teléfono). */
  castStats(): Promise<CastStats>;
  castResetStats(): Promise<boolean>;
  play(videoId: string, title: string): Promise<boolean>;
  togglePlay(): Promise<boolean>;
  pause(): Promise<boolean>;
  resume(): Promise<boolean>;
  seek(seconds: number): Promise<boolean>;
  stop(): Promise<boolean>;
  setEq(preset: string): Promise<boolean>;
}

// requireOptionalNativeModule devuelve null si el módulo nativo no está disponible,
// en lugar de lanzar una excepción que mata la app antes de renderizar.
export default requireOptionalNativeModule<QpAudioModule>('QpAudio');
