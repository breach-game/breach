import { useState } from 'react';
import { Desktop } from './os/Desktop.tsx';
import { Boot } from './screens/Boot.tsx';
import { Title } from './screens/Title.tsx';

type Screen = { name: 'title' } | { name: 'boot'; mode: 'new' | 'continue' } | { name: 'desktop' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'title' });
  if (screen.name === 'title') return <Title onStart={(mode) => setScreen({ name: 'boot', mode })} />;
  if (screen.name === 'boot')
    return (
      <Boot
        mode={screen.mode}
        onReady={() => setScreen({ name: 'desktop' })}
        onFail={() => setScreen({ name: 'title' })}
      />
    );
  return <Desktop onQuit={() => setScreen({ name: 'title' })} />;
}
