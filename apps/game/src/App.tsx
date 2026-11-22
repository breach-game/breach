import { lazy, Suspense, useEffect, useState } from 'react';
import { Recover, RecoverScreen } from './screens/Recover.tsx';
import { Title } from './screens/Title.tsx';
import type { StartMode } from './session.ts';

// The title screen loads alone: the engine, the terminal and the desktop come when a game starts.
const Boot = lazy(() => import('./screens/Boot.tsx').then((m) => ({ default: m.Boot })));
const Desktop = lazy(() => import('./os/Desktop.tsx').then((m) => ({ default: m.Desktop })));
const Missions = lazy(() => import('./screens/Missions.tsx').then((m) => ({ default: m.Missions })));
const Community = lazy(() => import('./screens/Community.tsx').then((m) => ({ default: m.Community })));

type Screen =
  | { name: 'title' }
  | { name: 'community' }
  | { name: 'missions' }
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
  if (screen.name === 'title')
    return (
      <Title
        onStart={(mode) => setScreen({ name: 'boot', mode })}
        onCommunity={() => setScreen({ name: 'community' })}
        onMissions={() => setScreen({ name: 'missions' })}
      />
    );
  return (
    <Suspense fallback={<main className="title" aria-busy="true" />}>
      {screen.name === 'missions' ? (
        <Missions
          onStart={(mode) => setScreen({ name: 'boot', mode })}
          onBack={() => setScreen({ name: 'title' })}
        />
      ) : screen.name === 'community' ? (
        <Community
          onStart={(mode) => setScreen({ name: 'boot', mode })}
          onBack={() => setScreen({ name: 'title' })}
        />
      ) : screen.name === 'boot' ? (
        <Boot
          mode={screen.mode}
          onReady={() => setScreen({ name: 'desktop' })}
          onFail={() => setScreen({ name: 'title' })}
        />
      ) : (
        <Desktop onQuit={() => setScreen({ name: 'title' })} />
      )}
    </Suspense>
  );
}
