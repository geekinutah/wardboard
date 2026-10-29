import type { ReactElement, ReactNode } from 'react';
import { useMe, useSync } from '../sync/react.tsx';
import { ImportSection } from './ImportSection.tsx';
import './first-import.css';

/** True once the server has reported the boards and there is no Current (SPEC §8). */
export function useNeedsFirstImport(): boolean {
  const { boards } = useSync();
  return boards !== null && boards.current === null;
}

/** With no Current the app opens the import workflow; otherwise it renders `children` as usual. */
export function FirstImportGate({ children }: { children: ReactNode }): ReactElement {
  const needsFirstImport = useNeedsFirstImport();
  return needsFirstImport ? <FirstImport /> : <>{children}</>;
}

/** The setup page: an Admin imports the three reports to create Current; an Editor is told to ask. */
export function FirstImport(): ReactElement {
  const me = useMe();
  if (me === null) {
    return (
      <main className="wb-first-import">
        <p className="wb-first-import-loading" role="status">
          Loading…
        </p>
      </main>
    );
  }
  return (
    <main className="wb-first-import">
      <div className="wb-first-import-page">
        <h1 className="wb-first-import-title">Set up WardBoard</h1>
        {me.role === 'admin' ? (
          <>
            <p className="wb-first-import-text">There&apos;s no Current board yet. Import the ward&apos;s three LCR reports to create it.</p>
            <ImportSection />
          </>
        ) : (
          <p className="wb-first-import-text">WardBoard has no Current board yet. Ask an Admin to import the ward&apos;s reports.</p>
        )}
      </div>
    </main>
  );
}
