export const FILM = {
  id: 'CinematicProductFilm',
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 3060,
} as const;

export const SHOTS = {
  gate: {from: 0, duration: 165},
  setup: {from: 165, duration: 390},
  task: {from: 555, duration: 240},
  execution: {from: 795, duration: 600},
  diff: {from: 1395, duration: 300},
  build: {from: 1695, duration: 240},
  product: {from: 1935, duration: 285},
  evaluation: {from: 2220, duration: 420},
  commands: {from: 2640, duration: 270},
  outro: {from: 2910, duration: 150},
} as const;
