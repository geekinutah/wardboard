import { Gallery } from './design/Gallery.tsx';
import { defaultHealthClient, type HealthClient } from './health.ts';
import { BoardShell } from './shell/BoardShell.tsx';
import { SETTINGS_PATH, SettingsRoute, usePathname } from './shell/SettingsRoute.tsx';
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
  const pathname = usePathname();
  // One SyncProvider for both routes, so switching never restarts the connection.
  return (
    <SyncProvider>
      {pathname === SETTINGS_PATH ? <SettingsRoute /> : <BoardShell healthClient={healthClient} />}
    </SyncProvider>
  );
}
