import { lazy, Suspense, useEffect, useState } from 'react';
import type { Go } from './screens/Journey.tsx';
import { Recover, RecoverScreen } from './screens/Recover.tsx';
import { Title } from './screens/Title.tsx';
import type { StartMode } from './session.ts';

// The title screen loads alone: the engine, the terminal and the desktop come when a game starts.
const Boot = lazy(() => import('./screens/Boot.tsx').then((m) => ({ default: m.Boot })));
const Desktop = lazy(() => import('./os/Desktop.tsx').then((m) => ({ default: m.Desktop })));
const Missions = lazy(() => import('./screens/Missions.tsx').then((m) => ({ default: m.Missions })));
const Training = lazy(() => import('./screens/Training.tsx').then((m) => ({ default: m.Training })));
const Community = lazy(() => import('./screens/Community.tsx').then((m) => ({ default: m.Community })));
const Seasons = lazy(() => import('./screens/Seasons.tsx').then((m) => ({ default: m.Seasons })));

type Screen =
  | { name: 'title'; picking?: boolean }
  | { name: 'community' }
  | { name: 'seasons'; open?: string }
  | { name: 'missions' }
  | { name: 'training' }
  | { name: 'boot'; mode: StartMode }
  | { name: 'desktop' };

export function App() {
  return (
    <Recover>
      <Screens />
    </Recover>
  );
}

function Screens() {
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  const [outdated, setOutdated] = useState(false);
  // A script or style this page preloads is gone from the server: the site was updated since.
  useEffect(() => {
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      setOutdated(true);
    };
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => window.removeEventListener('vite:preloadError', onPreloadError);
  }, []);
  if (outdated) return <RecoverScreen outdated />;
  const go = (to: Go) => {
    if ('start' in to) setScreen({ name: 'boot', mode: to.start });
    else if (to.screen === 'newGame') setScreen({ name: 'title', picking: true });
    else if (to.screen === 'seasons') setScreen({ name: 'seasons', ...(to.open ? { open: to.open } : {}) });
    else if (to.screen === 'title') setScreen({ name: 'title' });
    else if (to.screen === 'training') setScreen({ name: 'training' });
    else if (to.screen === 'missions') setScreen({ name: 'missions' });
    else setScreen({ name: 'community' });
  };
  if (screen.name === 'title')
    return <Title key={String(screen.picking)} go={go} picking={screen.picking ?? false} />;
  return (
    <Suspense fallback={<main className="title" aria-busy="true" />}>
      {screen.name === 'missions' ? (
        <Missions
          onStart={(mode) => setScreen({ name: 'boot', mode })}
          onBack={() => setScreen({ name: 'title' })}
        />
      ) : screen.name === 'training' ? (
        <Training
          onStart={(mode) => setScreen({ name: 'boot', mode })}
          onBack={() => setScreen({ name: 'title' })}
        />
      ) : screen.name === 'community' ? (
        <Community
          onStart={(mode) => setScreen({ name: 'boot', mode })}
          onBack={() => setScreen({ name: 'title' })}
          go={go}
        />
      ) : screen.name === 'seasons' ? (
        <Seasons {...(screen.open ? { open: screen.open } : {})} go={go} />
      ) : screen.name === 'boot' ? (
        <Boot
          mode={screen.mode}
          onReady={() => setScreen({ name: 'desktop' })}
          onFail={() => setScreen({ name: 'title' })}
        />
      ) : (
        <Desktop onQuit={(to) => go(to ?? { screen: 'title' })} />
      )}
    </Suspense>
  );
}
