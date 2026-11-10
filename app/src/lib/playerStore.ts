import { YtResult } from './api';

export type PlayerState = {
  actual: YtResult | null;
  reproduciendo: boolean;
  playerVisible: boolean;
  pos: number;
  dur: number;
};

type Listener = (state: PlayerState) => void;

let currentState: PlayerState = {
  actual: null,
  reproduciendo: false,
  playerVisible: false,
  pos: 0,
  dur: 0,
};

const listeners = new Set<Listener>();

// Handlers que Buscar.tsx registra para que el MiniPlayerGlobal pueda comandar
let togglePlayHandler: (() => void) | null = null;
let abrirPlayerHandler: (() => void) | null = null;
let cerrarHandler: (() => void) | null = null;

export const playerStore = {
  getState(): PlayerState {
    return currentState;
  },

  setState(partial: Partial<PlayerState>) {
    currentState = { ...currentState, ...partial };
    listeners.forEach((fn) => {
      try { fn(currentState); } catch (_) {}
    });
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(currentState);
    return () => {
      listeners.delete(fn);
    };
  },

  registerControls(controls: {
    togglePlay: () => void;
    abrirPlayer: () => void;
    cerrar: () => void;
  }) {
    togglePlayHandler = controls.togglePlay;
    abrirPlayerHandler = controls.abrirPlayer;
    cerrarHandler = controls.cerrar;
  },

  unregisterControls() {
    togglePlayHandler = null;
    abrirPlayerHandler = null;
    cerrarHandler = null;
  },

  togglePlay() {
    if (togglePlayHandler) togglePlayHandler();
  },

  abrirPlayer() {
    if (abrirPlayerHandler) abrirPlayerHandler();
  },

  cerrar() {
    if (cerrarHandler) cerrarHandler();
    this.setState({ actual: null, reproduciendo: false, playerVisible: false });
  },
};
