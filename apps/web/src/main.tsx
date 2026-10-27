import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './app.css';
import './design/tokens.css';

const PreviewApp = lazy(() => import('./preview/PreviewApp.tsx'));
const App = lazy(() => import('./App.tsx').then((m) => ({ default: m.App })));

export function isPreviewPath(pathname: string): boolean {
  return pathname === '/__preview' || pathname.startsWith('/__preview/');
}

export function Root({ pathname = typeof window !== 'undefined' ? window.location.pathname : '/' }: { pathname?: string } = {}) {
  if (isPreviewPath(pathname)) {
    return (
      <Suspense fallback={null}>
        <PreviewApp pathname={pathname} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}

if (!import.meta.env.VITEST) {
  const root = document.getElementById('root');
  if (root === null) throw new Error('Missing #root element');

  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
