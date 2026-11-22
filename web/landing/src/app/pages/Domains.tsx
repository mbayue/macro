/** Domains page (`#/domains`): add, verify, or remove your verified HTTPS origin. */
import { ArrowRightIcon, GlobeIcon, LockIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DitherBanner, StageBand, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
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
    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-5">
      <header className="flex flex-col justify-between gap-3 min-[861px]:flex-row min-[861px]:items-end">
        <div className="grid gap-1.5">
          <StageBand />
          <h1 className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]">
            Domains
          </h1>
        </div>
        <Badge variant="ok" className="bg-surface font-mono">1 verified HTTPS origin per account</Badge>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 min-[1180px]:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {me === null ? (
            <TelemetryPanel ticks="bar" aria-labelledby="domains-auth-heading">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-foreground">
                  <GlobeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <h2 id="domains-auth-heading" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em]">
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
            <h2 id="domains-how-heading" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
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
            <DitherBanner
              src="/landing/img/dither/sanok-static.webp"
              label="Domain rules & limits"
              meta="Single-origin allowlist"
            />
            <h2 id="domains-limits-heading" className="m-0 font-display text-[1.125rem] font-semibold tracking-[-0.025em] text-foreground">
              Domain rules &amp; limits
            </h2>
            <dl className="m-0 grid gap-2.5 text-xs">
              {DOMAIN_LIMITS.map((row) => (
                <div key={row.term} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-2.5 last:border-b-0 last:pb-0">
                  <dt className="text-muted-foreground">{row.term}</dt>
                  <dd className="m-0 text-right font-mono text-foreground">{row.detail}</dd>
                </div>
              ))}
            </dl>
          </TelemetryPanel>
        </aside>
      </div>
    </div>
  );
}
