import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { QpAudioEvents, ResolvedAudio } from './QpAudio.types';

declare class QpAudioModule extends NativeModule<QpAudioEvents> {
  resolveAudio(videoId: string): Promise<ResolvedAudio>;
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
