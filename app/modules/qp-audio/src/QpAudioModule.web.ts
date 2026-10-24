import { registerWebModule, NativeModule } from 'expo';
import type { QpAudioEvents, ResolvedAudio, ResolvedVideo } from './QpAudio.types';

// El extractor de NewPipe y el reproductor nativo existen solo en Android.
// En web este módulo no hace nada.
class QpAudioModule extends NativeModule<QpAudioEvents> {
  async resolveAudio(_videoId: string): Promise<ResolvedAudio> {
    throw new Error('QpAudio solo está disponible en Android');
  }
  async resolveVideo(_videoId: string): Promise<ResolvedVideo> {
    throw new Error('QpAudio solo está disponible en Android');
  }
  async play(_videoId: string, _title: string): Promise<boolean> {
    return false;
  }
  async togglePlay(): Promise<boolean> {
    return false;
  }
  async pause(): Promise<boolean> {
    return false;
  }
  async resume(): Promise<boolean> {
    return false;
  }
  async seek(_seconds: number): Promise<boolean> {
    return false;
  }
  async stop(): Promise<boolean> {
    return false;
  }
  async setEq(_preset: string): Promise<boolean> {
    return false;
  }
}

export default registerWebModule(QpAudioModule, 'QpAudio');
