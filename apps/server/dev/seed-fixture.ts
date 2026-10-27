import { buildFixtureProposal, buildFixtureWard } from '@wardboard/core/fixtures';
import type { Store } from '../src/store/index.ts';

export function seedFixture(store: Store): void {
  const { ward, current } = buildFixtureWard();
  const initialized = store.initialize({ ward, current, importVersion: 'fixture' });
  if (!initialized.ok) {
    throw new Error(
      `seedFixture failed to initialize: ${initialized.error.code}: ${initialized.error.message}`,
    );
  }
  const inserted = store.insertProposal(buildFixtureProposal(current, ward));
  if (!inserted.ok) {
    throw new Error(
      `seedFixture failed to insert the proposal: ${inserted.error.code}: ${inserted.error.message}`,
    );
  }
}
