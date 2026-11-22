import { lazy, Suspense, useState } from 'react';
import { Title } from './screens/Title.tsx';
import type { StartMode } from './session.ts';

// The title screen loads alone: the engine, the terminal and the desktop come when a game starts.
const Boot = lazy(() => import('./screens/Boot.tsx').then((m) => ({ default: m.Boot })));
const Desktop = lazy(() => import('./os/Desktop.tsx').then((m) => ({ default: m.Desktop })));
const Community = lazy(() => import('./screens/Community.tsx').then((m) => ({ default: m.Community })));

type Screen =
  | { name: 'title' }
  | { name: 'community' }
  | { name: 'boot'; mode: StartMode }
  | { name: 'desktop' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  if (screen.name === 'title')
    return (
      <Title
        onStart={(mode) => setScreen({ name: 'boot', mode })}
        onCommunity={() => setScreen({ name: 'community' })}
      />
    );
  return (
    <Suspense fallback={<main className="title" aria-busy="true" />}>
      {screen.name === 'community' ? (
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
