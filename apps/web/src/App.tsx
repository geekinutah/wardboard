import { useEffect, useState } from 'react';
import { Gallery } from './design/Gallery.tsx';
import { checkHealth, defaultHealthClient, type HealthClient, type HealthState } from './health.ts';

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
    <div className="shell">
      <header className="shell-header">
        <span className="shell-brand">WardBoard</span>
      </header>
      <main className="shell-main">
        <p className="shell-status" role="status" data-state={health}>
          {STATUS_TEXT[health]}
        </p>
      </main>
    </div>
  );
}
