import type {FC} from 'react';
import {Composition} from 'remotion';
import {CinematicFilm, type CinematicFilmProps} from './CinematicFilm';
import {FILM} from './film.config';

export const Root: FC = () => {
  return (
    <Composition
      id={FILM.id}
      component={CinematicFilm}
      durationInFrames={FILM.durationInFrames}
      fps={FILM.fps}
      width={FILM.width}
      height={FILM.height}
      defaultProps={{bgm: true} satisfies CinematicFilmProps}
    />
  );
};
