import type { ResolvedAudio } from './QpAudio.types';

// El extractor de NewPipe y el reproductor nativo existen solo en Android.
// En iOS el audio usa el camino del servidor (NATIVE_AUDIO === false).
const sinSoporte = async () => false;

const QpAudioModule = {
  async resolveAudio(_videoId: string): Promise<ResolvedAudio> {
    throw new Error('QpAudio solo está disponible en Android');
  },
  play: sinSoporte,
  togglePlay: sinSoporte,
  pause: sinSoporte,
  resume: sinSoporte,
  seek: sinSoporte,
  stop: sinSoporte,
  setEq: sinSoporte,
  addListener: (_event: string, _listener: (...args: any[]) => void) => ({ remove: () => {} }),
  removeListener: () => {},
  removeAllListeners: () => {},
  emit: () => {},
  listenerCount: () => 0,
};

export default QpAudioModule;
