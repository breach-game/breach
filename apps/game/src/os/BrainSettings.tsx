import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  BRAIN_CALL_LIMIT,
  BRAIN_MODELS,
  BRAIN_USES,
  type BrainModel,
  type BrainUse,
  CAMPAIGN_MESSAGES,
  estimate,
  setBrainConfig,
  testBrain,
  useBrain,
} from '../brain.ts';
import { useSettings } from '../settings.ts';
import { type UiKey, useT } from '../ui.ts';

/** A price in US dollars, readable at any size: 0.0003 $ as well as 1.20 $. */
export function money(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumSignificantDigits: value > 0 && value < 1 ? 2 : 3,
  }).format(value);
}

/**
 * Optional: help the characters with the player's own API key. Everything the player needs to
 * decide is on this one screen: what each use does, what it is likely to cost, what is sent, where
 * the key is kept.
 */
export function BrainSettings({ onClose }: { onClose(): void }) {
  const t = useT();
  const { locale } = useSettings();
  const { config, last, usage } = useBrain();
  const [key, setKey] = useState(config.key);
  const [remember, setRemember] = useState(config.remember);
  const [testing, setTesting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const dirty = key.trim() !== config.key || remember !== config.remember;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBrainConfig({ key, remember });
    if (!key.trim()) return;
    setTesting(true);
    await testBrain();
    setTesting(false);
  };
  const remove = () => {
    setKey('');
    setRemember(false);
    setBrainConfig({ key: '', remember: false });
  };
  const anyOn = BRAIN_USES.some((u) => config[u].on);
  const state: UiKey = testing
    ? 'brain.state.testing'
    : !config.key
      ? 'brain.state.script'
      : !anyOn
        ? 'brain.state.none'
        : last === null || last === 'ok'
          ? 'brain.state.on'
          : (`brain.issue.${last}` as UiKey);
  const tone = testing || !config.key || !anyOn ? 'idle' : last === null || last === 'ok' ? 'on' : 'warn';
  const usd = (v: number) => money(v, locale);
  const perMessage = BRAIN_USES.reduce(
    (sum, u) => sum + (config[u].on ? estimate(u, config[u].model) : 0),
    0,
  );
  const spent = usage.hear.cost + usage.voice.cost;

  return (
    <form className="brain scroll" onSubmit={save}>
      <div className="kicker">{t('brain.kicker')}</div>
      <h2>{t('brain.title')}</h2>
      <p>{t('brain.intro')}</p>
      <label>
        <span>{t('brain.key')}</span>
        <input
          ref={input}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          maxLength={300}
        />
      </label>
      <fieldset className="uses">
        <legend>{t('brain.uses')}</legend>
        {BRAIN_USES.map((u) => (
          <UseRow key={u} use={u} usd={usd} />
        ))}
        <p className="total" role="status">
          {anyOn
            ? t('brain.total', {
                message: usd(perMessage),
                campaign: usd(perMessage * CAMPAIGN_MESSAGES),
                count: CAMPAIGN_MESSAGES,
              })
            : t('brain.total.none')}
        </p>
        {config.key && <p className="usage">{t('brain.spent', { cost: usd(spent) })}</p>}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t('brain.remember')}</span>
      </label>
      <div className="state" data-tone={tone} role="status">
        <i aria-hidden="true" />
        {t(state, { limit: BRAIN_CALL_LIMIT })}
      </div>
      <ul>
        <li>{t('brain.fact.script')}</li>
        <li>{t('brain.fact.sent')}</li>
        <li>{t('brain.fact.key')}</li>
        <li>{t('brain.fact.cost')}</li>
      </ul>
      <div className="actions">
        <button type="submit" className="btn ai" disabled={testing || (!dirty && !config.key)}>
          {t(dirty || !config.key ? 'brain.save' : 'brain.test')}
        </button>
        {config.key && (
          <button type="button" className="btn" onClick={remove}>
            {t('brain.remove')}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>
          {t('brain.close')}
        </button>
      </div>
    </form>
  );
}

/** One thing the key may be used for: a switch, its model, and what it costs. */
function UseRow({ use, usd }: { use: BrainUse; usd(v: number): string }) {
  const t = useT();
  const { config, usage } = useBrain();
  const choice = config[use];
  const done = usage[use];
  const id = `brain-use-${use}`;
  return (
    <div className="use" data-on={choice.on}>
      <label className="check">
        <input
          type="checkbox"
          checked={choice.on}
          onChange={(e) => setBrainConfig({ [use]: { ...choice, on: e.target.checked } })}
          aria-describedby={`${id}-what`}
        />
        <span>
          <b>{t(`brain.use.${use}` as UiKey)}</b>
          <small id={`${id}-what`}>{t(`brain.use.${use}.what` as UiKey)}</small>
        </span>
      </label>
      <div className="use-model">
        <select
          aria-label={t('brain.model')}
          value={choice.model}
          disabled={!choice.on}
          onChange={(e) => setBrainConfig({ [use]: { ...choice, model: e.target.value as BrainModel } })}
        >
          {BRAIN_MODELS.map((m) => (
            <option key={m} value={m}>
              {m} · {t(`brain.model.${m}` as UiKey)}
            </option>
          ))}
        </select>
        <span className="cost">
          {choice.on ? t('brain.cost', { cost: usd(estimate(use, choice.model)) }) : t('brain.cost.off')}
          {done.calls > 0 && (
            <>
              {' · '}
              {t('brain.used', { calls: done.calls, limit: BRAIN_CALL_LIMIT })}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
