import { useEffect, useRef, useState } from 'react';
import { HOW_STEPS } from '../data.ts';

const LAST = HOW_STEPS.length - 1;
/** Matches the 120ms swap-out transition on .how.is-swapping in styles.css. */
const SWAP_OUT_MS = 120;

/** Drag (or arrow-key) through the four stages; the clause and the screenshot swap together. */
export function HowItWorks() {
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const fill = useRef<HTMLSpanElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);

  // CSS custom properties are set through the CSSOM (never a style attribute), which the CSP allows.
  useEffect(() => {
    fill.current?.style.setProperty('--fill', `${(step / LAST) * 100}%`);
  }, [step]);

  // Fade out quickly (the system responding), swap the content, then fade in. Reduced motion keeps
  // this: it is an opacity change, and styles.css drops the blur.
  useEffect(() => {
    if (step === shown) return;
    setSwapping(true);
    const t = window.setTimeout(() => {
      setShown(step);
      setSwapping(false);
    }, SWAP_OUT_MS);
    return () => window.clearTimeout(t);
  }, [step, shown]);

  // Preload the other screenshots so the swap never shows an empty frame.
  useEffect(() => {
    for (const s of HOW_STEPS) new Image().src = s.img;
  }, []);

  const s = HOW_STEPS[shown] ?? HOW_STEPS[0]!;
  const current = HOW_STEPS[step] ?? HOW_STEPS[0]!;

  return (
    <section className={swapping ? 'how is-swapping' : 'how'} id="how" aria-label="How it works">
      <div className="how__clause">
        <h2 aria-live="polite">{s.title}</h2>
        <p>{s.text}</p>
      </div>
      <div className="how__shot">
        <div className="how__frame">
          <div className="how__chrome" aria-hidden="true">
            <span className="how__dots">
              <i />
              <i />
              <i />
            </span>
            <span className="how__route">macro.my.id/app</span>
            <span className="how__step-tag">
              0{shown + 1} / 0{HOW_STEPS.length} · {s.name}
            </span>
          </div>
          <div className="how__viewport">
            <img src={s.img} width={s.width} height={s.height} alt={s.alt} />
          </div>
        </div>
      </div>
      <div className="how__control">
        <label htmlFor="how-range" className="visually-hidden">
          Step through how Macro works
        </label>
        <div className="how__slider">
          <div className="how__track" aria-hidden="true">
            <span ref={fill} />
          </div>
          <input
            ref={rangeRef}
            id="how-range"
            type="range"
            min={0}
            max={LAST}
            step={1}
            value={step}
            aria-valuetext={current.name}
            onChange={(e) => setStep(Number(e.target.value))}
          />
        </div>
        <ol className="how__stops">
          {HOW_STEPS.map((h, i) => (
            <li key={h.name} className={i === step ? 'is-current' : undefined}>
              <button
                type="button"
                onClick={() => {
                  setStep(i);
                  rangeRef.current?.focus();
                }}
              >
                {h.name}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
