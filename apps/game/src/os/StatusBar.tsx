import { gameDate, socLevel } from '@breach/engine';
import { useState } from 'react';
import { activeBrain, useBrain } from '../brain.ts';
import { Mark } from '../brand.tsx';
import { liveClock, missionNumber, useGame } from '../session.ts';
import { updateSettings, useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

const LEVELS = ['guided', 'standard', 'expert'] as const;

interface Props {
  noise: number;
  onResetLayout(): void;
  onQuit(): void;
  onBrain(): void;
}

export function StatusBar({ noise, onResetLayout, onQuit, onBrain }: Props) {
  const game = useGame();
  const t = useT();
  const settings = useSettings();
  const [menu, setMenu] = useState(false);
  const brain = useBrain();
  const pack = game.state.mission ? game.missions.get(game.state.mission) : undefined;
  const title = pack?.title[settings.locale] ?? pack?.title.fr ?? pack?.title.en ?? '';
  const level = socLevel(noise);
  // Defence missions: the gauge shows what the containment costs the business, not the noise.
  const defending = pack?.mission?.side === 'defense';
  const impact = game.state.impact ?? 0;
  const stopped = game.state.adversary?.stopped || game.state.missionDone;
  return (
    <>
      <header className="bar">
        <div className="os">
          <Mark aria-hidden="true" />
          LR-OS <span>{t('bar.os')}</span>
        </div>
        <div className="mission">
          {t(pack?.track === 'training' ? 'bar.training' : 'bar.mission')} {missionNumber(game)} <b>/</b>{' '}
          {title}
        </div>
        {defending ? (
          <>
            <div
              className="gauge impact"
              role="meter"
              aria-label={t('bar.impact')}
              aria-valuenow={Math.round(impact)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span>{t('bar.impact')}</span>
              <div className="track">
                <div className="fill" style={{ width: `${impact}%` }} />
              </div>
              <span className="val">{Math.round(impact)} %</span>
            </div>
            <div className="soc attacker" data-level={stopped ? 'stopped' : 'active'}>
              <i />
              <span>{t(stopped ? 'bar.attacker.stopped' : 'bar.attacker.active')}</span>
            </div>
          </>
        ) : (
          <>
            <div
              className="gauge"
              role="meter"
              aria-label={t('bar.noise')}
              aria-valuenow={Math.round(noise)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span>{t('bar.noise')}</span>
              <div className="track">
                <div className="fill" style={{ width: `${noise}%` }} />
              </div>
              <span className="val">{Math.round(noise)} %</span>
            </div>
            <div className="soc" data-level={level}>
              <i />
              <span>{t(`bar.soc.${level}` as UiKey)}</span>
            </div>
          </>
        )}
        <div className="clock">{gameDate(game.world.startTime, liveClock(game)).time}</div>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('bar.settings')}
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M2 4h8M13 4h1M2 8h2M7 8h7M2 12h6M11 12h3" strokeLinecap="round" />
            <circle cx="11.5" cy="4" r="1.5" />
            <circle cx="5.5" cy="8" r="1.5" />
            <circle cx="9.5" cy="12" r="1.5" />
          </svg>
        </button>
      </header>
      {menu && (
        <div className="menu" role="dialog" aria-label={t('bar.settings')}>
          <div className="row">
            {t('settings.language')}
            <span className="seg">
              {(['fr', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={settings.locale === l}
                  onClick={() => {
                    updateSettings({ locale: l });
                    game.setLocale(l);
                  }}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </span>
          </div>
          <div className="row">
            {t('settings.guidance')}
            <span className="seg">
              {LEVELS.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={settings.guidance === g}
                  onClick={() => updateSettings({ guidance: g })}
                >
                  {t(`guidance.${g}` as UiKey)}
                </button>
              ))}
            </span>
          </div>
          <div className="row">
            {t('settings.effects')}
            <span className="seg">
              <button
                type="button"
                aria-pressed={settings.effects}
                onClick={() => updateSettings({ effects: true })}
              >
                {t('on')}
              </button>
              <button
                type="button"
                aria-pressed={!settings.effects}
                onClick={() => updateSettings({ effects: false })}
              >
                {t('off')}
              </button>
            </span>
          </div>
          <div className="row">
            {t('settings.sound')}
            <span className="seg">
              <button
                type="button"
                aria-pressed={settings.sound}
                onClick={() => updateSettings({ sound: true })}
              >
                {t('sound.on')}
              </button>
              <button
                type="button"
                aria-pressed={!settings.sound}
                onClick={() => updateSettings({ sound: false })}
              >
                {t('sound.off')}
              </button>
            </span>
          </div>
          {(['music', 'sfx'] as const).map((k) => (
            <label className="row" key={k}>
              {t(`settings.${k}`)}
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(settings[k] * 100)}
                disabled={!settings.sound}
                onChange={(e) => updateSettings({ [k]: Number(e.target.value) / 100 })}
              />
            </label>
          ))}
          <div className="row">
            {t('settings.brain')}
            <span className="seg">
              <button
                type="button"
                data-ai={brain.config.key ? 'on' : 'off'}
                onClick={() => {
                  onBrain();
                  setMenu(false);
                }}
              >
                {t(activeBrain() ? 'settings.brain.on' : 'settings.brain.off')} ›
              </button>
            </span>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onResetLayout();
              setMenu(false);
            }}
          >
            {t('settings.layout')}
          </button>
          <button type="button" className="btn" onClick={onQuit}>
            {t('settings.quit')}
          </button>
        </div>
      )}
    </>
  );
}
