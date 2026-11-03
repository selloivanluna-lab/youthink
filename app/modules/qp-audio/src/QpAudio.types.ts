export type ResolvedAudio = {
  url: string;
  title: string;
  bitrate: number;
  mime: string;
  userAgent: string;
};

export type ResolvedVideo = {
  url: string;
  title: string;
  resolution: string;
  mime: string;
  userAgent: string;
};

/** Medio servido por el teléfono para el Chromecast (red local). */
export type CastSource = {
  url: string;
  mime: string;
  port: number;
  ip: string;
};

export type CastSelfTest = {
  ok: boolean;
  url: string;
  ip: string;
  port: number;
  mime: string;
  status: number;
  bytes: number;
  contentType: string;
  ms: number;
  error: string;
};

export type CastStats = {
  hits: number;
  lastPath: string;
  lastStatus: number;
  port: number;
  ip: string;
};

export type PlaybackState = {
  isPlaying: boolean;
  position: number;
  duration: number;
  mediaId: string;
  buffering?: boolean;
  ended?: boolean;
  error?: string;
  resolving?: boolean;
};

export type QpAudioEvents = {
  onPlaybackState: (state: PlaybackState) => void;
};
