/** Domains page (`#/domains`): add, verify, switch, or remove your verified HTTPS origin. */
import { ArrowRightIcon, GlobeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { VerifyPanel } from '../components/VerifyPanel.tsx';
import { useApp } from '../context.tsx';

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

      <div className="max-w-[760px]">
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
      </div>
    </div>
  );
}
