import { useState } from 'react';

/** Showcase: the approve switch, blown up. Operating it changes the field colour and one word. */
export function ApproveSwitch() {
  const [on, setOn] = useState(false);
  return (
    <section className={on ? 'showcase is-on' : 'showcase'} id="showcase" aria-labelledby="showcase-title">
      <div className="wrap showcase__copy">
        <h2 id="showcase-title" data-reveal>
          Plan is {on ? 'approved' : 'draft'}
        </h2>
        <p data-reveal data-i="1">
          Nothing reaches your site until you approve. The approved plan is stored with a fingerprint of its exact text (SHA-256), and the run executes exactly that text.
        </p>
      </div>
      <div className="switch" data-ui>
        <div className="switch__label" id="sw-label">
          Approve and run<span>{on ? 'Plan f1913cb7, hash locked' : 'Plan f1913cb7, still a draft'}</span>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="sw-label" onClick={() => setOn((v) => !v)}>
          <span className="switch__knob" />
        </button>
      </div>
    </section>
  );
}
