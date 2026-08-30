/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PIWIN_SHELL_ONLY?: string;
  /** Dev-only R1 WebRTC spike (`#/live-spike`). Never ship enabled. */
  readonly VITE_PIWIN_LIVE_SPIKE?: string;
}
