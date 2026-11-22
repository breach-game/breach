import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@xterm/xterm/css/xterm.css';
import './theme/tokens.css';
import './theme/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { audioProbe, setTension, unlockAudio } from './audio.ts';

// Browsers only let a page make sound after the player has clicked or typed.
for (const type of ['pointerdown', 'keydown'] as const)
  window.addEventListener(type, unlockAudio, { capture: true });
if (import.meta.env.DEV) Object.assign(window, { __audio: { audioProbe, setTension } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
