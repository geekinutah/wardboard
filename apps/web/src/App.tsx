import { Gallery } from './design/Gallery.tsx';
import { defaultHealthClient, type HealthClient } from './health.ts';
import { BoardShell } from './shell/BoardShell.tsx';
import { SyncProvider } from './sync/react.tsx';

export type AppProps = {
  healthClient?: HealthClient;
};

export function App({ healthClient = defaultHealthClient }: AppProps) {
  if (window.location.pathname === '/__gallery') {
    return <Gallery />;
  }
  return <AppShell healthClient={healthClient} />;
}

function AppShell({ healthClient }: { healthClient: HealthClient }) {
  return (
    <SyncProvider>
      <BoardShell healthClient={healthClient} />
    </SyncProvider>
  );
}
