/** Domains page (`#/domains`): add, verify, or remove your verified HTTPS origin. */
import { ArrowRightIcon, GlobeIcon, LockIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { VerifyPanel } from '../components/VerifyPanel.tsx';
import { useApp } from '../context.tsx';

const HOW_IT_WORKS = [
  {
    icon: SearchIcon,
    title: 'Safe route discovery',
    body: 'Macro fetches / and linked scripts on your origin to build a route catalog. It never executes page JavaScript.',
  },
  {
    icon: LockIcon,
    title: 'Private to your account',
    body: 'Own-site plans, runs, and capacity reports stay private and are never published to public demo trends.',
  },
  {
    icon: ShieldCheckIcon,
    title: 'Egress containment',
    body: 'Each Stage runs in a gVisor sandbox whose egress proxy permits HTTPS requests only to your verified host.',
  },
] as const;

const DOMAIN_LIMITS = [
  { term: 'Verified origins', detail: '1 HTTPS origin per account (remove to switch)' },
  { term: 'Verification', detail: 'Domain Connect, DNS TXT (_macro-verify), or /.well-known/' },
  { term: 'Policy Gate caps', detail: 'Up to 500 VUs per Stage · 1–6 Stages · 600 s max' },
  { term: 'Authorization', detail: 'Only verify sites you own or are authorized to test' },
] as const;

export function Domains() {
  const { me } = useApp();

  return (
    <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6">
      <header className="grid gap-2">
        <h1 className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]">
          Domains
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          Verify one HTTPS origin you own to run private load tests against your own site in Test Studio.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-4">
          {me === null ? (
            <TelemetryPanel ticks="bar" aria-labelledby="domains-auth-heading">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-foreground">
                  <GlobeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <h2 id="domains-auth-heading" className="m-0 font-sans text-[1.0625rem] font-medium">
                    Sign in to verify a domain
                  </h2>
                </div>
                <p className="m-0 text-sm text-muted-foreground">
                  Own-site verification and private load tests are tied to your account. The public demo shop still works signed out in Test Studio.
                </p>
                <div>
                  <Button render={<a href="#/sign-in" />} nativeButton={false}>
                    Sign in
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            </TelemetryPanel>
          ) : (
            <VerifyPanel initialHost="" />
          )}

          <TelemetryPanel ticks="bar" aria-labelledby="domains-how-heading">
            <h2 id="domains-how-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              How own-site testing works
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {HOW_IT_WORKS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3.5">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Icon className="size-4 shrink-0 text-accent-text" aria-hidden="true" />
                      <span>{item.title}</span>
                    </div>
                    <p className="m-0 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </TelemetryPanel>
        </div>

        <aside aria-label="Domain rules and limits" className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20">
          <TelemetryPanel ticks="bar" aria-labelledby="domains-limits-heading">
            <h2 id="domains-limits-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              Domain rules &amp; limits
            </h2>
            <dl className="m-0 grid gap-3">
              {DOMAIN_LIMITS.map((row) => (
                <div key={row.term} className="grid gap-0.5 border-t border-border pt-2.5 first:border-t-0 first:pt-0">
                  <dt className="text-xs font-medium text-muted-foreground">{row.term}</dt>
                  <dd className="m-0 text-sm text-foreground">{row.detail}</dd>
                </div>
              ))}
            </dl>
          </TelemetryPanel>
        </aside>
      </div>
    </div>
  );
}
