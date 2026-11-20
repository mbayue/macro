/**
 * "The gate says yes / no": the Policy Gate as one control blown up. A two-option segmented control
 * (aria-pressed on each option) at poster size, cropped by the section's edge, on a full-bleed field
 * that is spring green for the accepted plan and the bad red for the rejected one. The field keeps
 * these fixed colours in both themes, like a product fragment.
 *
 * Both answers are in the prerendered HTML (the inactive one `hidden`), so the page says what the gate
 * does even before hydration. The heading's yes/no is announced politely.
 */
import { useState } from 'react';

const ANSWERS = {
  own: 'Target https://yue.macro.my.id is verified. 25, 50, 100, 200 users, 240 s in total, ready to Approve and run.',
  other: 'Rule 4.2: target origin https://shop.example.com is not verified. 0 requests sent, and there is no approve button.',
} as const;

const OPTION =
  'min-h-11 cursor-pointer rounded-[0.1em] border-0 px-[0.42em] py-[0.18em] font-display font-light leading-none tracking-[-0.03em] whitespace-nowrap transition-colors duration-200 focus-visible:outline-[0.05em] focus-visible:outline-offset-[0.04em] focus-visible:outline-white focus-visible:outline-solid active:scale-[0.98]';
const ON = 'bg-white text-[#001e2b]';
const OFF = 'bg-transparent text-[#9ea2a1] pointer-fine:hover:text-white';

export function Gate() {
  const [own, setOwn] = useState(true);
  return (
    <section
      className={`relative mt-[clamp(120px,14vw,200px)] min-h-[86svh] overflow-hidden px-5 py-10 transition-colors duration-300 split:min-h-[92svh] split:px-10 split:py-14 ${
        own ? 'bg-[#00ed64] text-[#001e2b]' : 'bg-[#b3261e] text-white'
      }`}
      aria-labelledby="gate-title"
    >
      <div className="relative z-[1] max-w-[46ch]">
        <h2
          id="gate-title"
          aria-live="polite"
          className="font-display text-[10vw] leading-none font-light tracking-[-0.03em] split:text-[clamp(36px,4.2vw,68px)]"
        >
          {`The gate says ${own ? 'yes' : 'no'}`}
        </h2>
        <p className="mt-5 text-lg" hidden={!own}>
          {ANSWERS.own}
        </p>
        <p className="mt-5 text-lg" hidden={own}>
          {ANSWERS.other}
        </p>
      </div>
      <div
        data-ui
        role="group"
        aria-label="Where the plan points"
        className="absolute bottom-[8%] -left-[4%] flex gap-[0.08em] rounded-[0.14em] bg-[#001e2b] p-[0.08em] text-[15vw] split:right-[-8%] split:bottom-[10%] split:left-auto split:text-[clamp(56px,8.5vw,150px)]"
      >
        <button type="button" aria-pressed={own} className={`${OPTION} ${own ? ON : OFF}`} onClick={() => setOwn(true)}>
          Your site
        </button>
        <button type="button" aria-pressed={!own} className={`${OPTION} ${own ? OFF : ON}`} onClick={() => setOwn(false)}>
          Someone else&rsquo;s
        </button>
      </div>
    </section>
  );
}
