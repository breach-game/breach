import { type FormEvent, useEffect, useRef, useState } from 'react';
import { BRAIN_MODELS, type BrainModel, setBrainConfig, testBrain, useBrain } from '../brain.ts';
import { type UiKey, useT } from '../ui.ts';

/**
 * Optional: give the characters a voice with the player's own API key. Everything the player needs
 * to decide is on this one screen: what the model does, what is sent, where the key is kept.
 */
export function BrainSettings({ onClose }: { onClose(): void }) {
  const t = useT();
  const { config, last } = useBrain();
  const [key, setKey] = useState(config.key);
  const [model, setModel] = useState<BrainModel>(config.model);
  const [remember, setRemember] = useState(config.remember);
  const [testing, setTesting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const dirty = key.trim() !== config.key || model !== config.model || remember !== config.remember;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBrainConfig({ key, model, remember });
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
  const state: UiKey = testing
    ? 'brain.state.testing'
    : !config.key
      ? 'brain.state.script'
      : last === null || last === 'ok'
        ? 'brain.state.on'
        : (`brain.issue.${last}` as UiKey);
  const tone = testing || !config.key ? 'idle' : last === null || last === 'ok' ? 'on' : 'warn';

  return (
    <form className="brain scroll" onSubmit={save}>
      <div className="kicker">{t('brain.kicker')}</div>
      <h2>{t('brain.title')}</h2>
      <p>{t('brain.intro')}</p>
      <ul>
        <li>{t('brain.fact.script')}</li>
        <li>{t('brain.fact.sent')}</li>
        <li>{t('brain.fact.key')}</li>
        <li>{t('brain.fact.cost')}</li>
      </ul>
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
      <label>
        <span>{t('brain.model')}</span>
        <select value={model} onChange={(e) => setModel(e.target.value as BrainModel)}>
          {BRAIN_MODELS.map((m) => (
            <option key={m} value={m}>
              {m} · {t(`brain.model.${m}` as UiKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t('brain.remember')}</span>
      </label>
      <div className="state" data-tone={tone} role="status">
        <i aria-hidden="true" />
        {t(state)}
      </div>
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
