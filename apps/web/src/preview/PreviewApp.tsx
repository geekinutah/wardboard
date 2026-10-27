import { useEffect, useMemo, useState } from 'react';
import { getPreviewData } from './data.ts';
import type { PreviewData, PreviewLoader, PreviewModule, PreviewModuleMap } from './types.ts';
import './preview.css';

export interface PreviewAppProps {
  pathname?: string;
  modules?: PreviewModuleMap;
  data?: PreviewData;
}

export function parseFeatureName(path: string): string {
  const match = path.match(/(?:^|\/)features\/([^/]+)\/preview\.[jt]sx?$/);
  if (match && match[1]) {
    return match[1];
  }
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function extractPreviewName(pathname: string): string | null {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === '/__preview' || trimmed === '') return null;
  if (trimmed.startsWith('/__preview/')) {
    const rest = trimmed.slice('/__preview/'.length);
    return rest.length > 0 ? rest : null;
  }
  return null;
}

async function resolveModule(loaderOrModule: PreviewLoader | PreviewModule): Promise<PreviewModule> {
  if (typeof loaderOrModule === 'function') {
    const result = await loaderOrModule();
    if ('default' in result) {
      return result.default;
    }
    return result;
  }
  return loaderOrModule;
}

const defaultModules = import.meta.glob('../features/*/preview.tsx') as Record<string, PreviewLoader>;

export function PreviewApp({
  pathname = typeof window !== 'undefined' ? window.location.pathname : '/__preview',
  modules = defaultModules,
  data = getPreviewData(),
}: PreviewAppProps) {
  const previewName = extractPreviewName(pathname);

  const modulesByName = useMemo(() => {
    const map = new Map<string, PreviewLoader | PreviewModule>();
    for (const [key, value] of Object.entries(modules)) {
      const name = parseFeatureName(key);
      map.set(name, value);
    }
    return map;
  }, [modules]);

  // Index state: list of { name, title }
  const [indexItems, setIndexItems] = useState<Array<{ name: string; title: string }> | null>(() => {
    const entries = Array.from(modulesByName.entries());
    if (entries.length === 0) return [];
    const allSynchronous = entries.every(([, v]) => typeof v !== 'function');
    if (allSynchronous) {
      return entries
        .map(([name, v]) => ({ name, title: (v as PreviewModule).title }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    }
    return null;
  });

  useEffect(() => {
    let active = true;
    const entries = Array.from(modulesByName.entries());
    if (entries.length === 0) {
      setIndexItems([]);
      return;
    }

    void Promise.all(
      entries.map(async ([name, loaderOrMod]) => {
        const mod = await resolveModule(loaderOrMod);
        return { name, title: mod.title };
      }),
    ).then((items) => {
      if (active) {
        items.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        setIndexItems(items);
      }
    });

    return () => {
      active = false;
    };
  }, [modulesByName]);

  // Single preview module state
  const targetEntry = previewName !== null ? modulesByName.get(previewName) : undefined;
  const [activeModule, setActiveModule] = useState<PreviewModule | null>(() => {
    if (targetEntry && typeof targetEntry !== 'function') {
      return targetEntry;
    }
    return null;
  });

  useEffect(() => {
    let active = true;
    if (targetEntry === undefined) {
      setActiveModule(null);
      return;
    }

    if (typeof targetEntry === 'function') {
      void resolveModule(targetEntry).then((mod) => {
        if (active) {
          setActiveModule(mod);
        }
      });
    } else {
      setActiveModule(targetEntry);
    }

    return () => {
      active = false;
    };
  }, [targetEntry]);

  // Case 1: Index page (/__preview)
  if (previewName === null) {
    return (
      <div className="wb-preview-root">
        <main className="wb-preview-content">
          <div className="wb-preview-index">
            <h1>Previews</h1>
            {indexItems === null ? (
              <p className="wb-preview-empty">Loading previews…</p>
            ) : indexItems.length === 0 ? (
              <p className="wb-preview-empty">No previews yet.</p>
            ) : (
              <ul className="wb-preview-list">
                {indexItems.map((item) => (
                  <li key={item.name}>
                    <a href={`/__preview/${item.name}`} className="wb-preview-link">
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    );
  }

  // Case 2: Unknown preview name
  if (!modulesByName.has(previewName)) {
    return (
      <div className="wb-preview-root">
        <header className="wb-preview-bar">
          <h2 className="wb-preview-bar-title">Preview not found</h2>
          <a href="/__preview" className="wb-preview-bar-link">
            All previews
          </a>
        </header>
        <main className="wb-preview-content">
          <div className="wb-preview-not-found-container">
            <p className="wb-preview-not-found">No preview named {previewName}.</p>
            <a href="/__preview" className="wb-preview-link">
              Back to index
            </a>
          </div>
        </main>
      </div>
    );
  }

  // Case 3: Known preview name, loading
  if (activeModule === null) {
    return (
      <div className="wb-preview-root">
        <header className="wb-preview-bar">
          <h2 className="wb-preview-bar-title">Loading preview…</h2>
          <a href="/__preview" className="wb-preview-bar-link">
            All previews
          </a>
        </header>
        <main className="wb-preview-content" />
      </div>
    );
  }

  // Case 4: Known preview name, loaded
  return (
    <div className="wb-preview-root">
      <header className="wb-preview-bar">
        <h2 className="wb-preview-bar-title">{activeModule.title}</h2>
        <a href="/__preview" className="wb-preview-bar-link">
          All previews
        </a>
      </header>
      <main className="wb-preview-content">
        {activeModule.render(data)}
      </main>
    </div>
  );
}

export default PreviewApp;
