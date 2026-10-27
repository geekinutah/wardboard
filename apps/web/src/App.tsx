import { useEffect, useState } from 'react';
import { Gallery } from './design/Gallery.tsx';
import { checkHealth, defaultHealthClient, type HealthClient, type HealthState } from './health.ts';
import { ConnectionIndicator, SyncBanner, SyncProvider } from './sync/react.tsx';

export type AppProps = {
  healthClient?: HealthClient;
};

const STATUS_TEXT: Readonly<Record<HealthState, string>> = {
  pending: 'Checking server…',
  ok: 'Server: ok',
  unreachable: 'Server unreachable',
};

export function App({ healthClient = defaultHealthClient }: AppProps) {
  if (window.location.pathname === '/__gallery') {
    return <Gallery />;
  }
  return <AppShell healthClient={healthClient} />;
}

function AppShell({ healthClient }: { healthClient: HealthClient }) {
  const [health, setHealth] = useState<HealthState>('pending');

  useEffect(() => {
    let active = true;
    void checkHealth(healthClient).then((result) => {
      if (active) setHealth(result);
    });
    return () => {
      active = false;
    };
  }, [healthClient]);

  return (
    <SyncProvider>
      <div className="shell">
        <header className="shell-header">
          <span className="shell-brand">WardBoard</span>
          <ConnectionIndicator />
        </header>
        <main className="shell-main">
          <SyncBanner />
          <p className="shell-status" role="status" data-state={health}>
            {STATUS_TEXT[health]}
          </p>
        </main>
      </div>
    </SyncProvider>
  );
}
