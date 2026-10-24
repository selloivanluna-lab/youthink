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
