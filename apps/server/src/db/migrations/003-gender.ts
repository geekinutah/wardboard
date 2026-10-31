import type { Migration } from '../types.ts';

export const genderMigration: Migration = {
  id: 3,
  name: 'gender',
  up: `
ALTER TABLE members ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('M', 'F'));
ALTER TABLE calling_assignments ADD COLUMN gender_rule TEXT CHECK (gender_rule IS NULL OR gender_rule IN ('M', 'F', 'any', 'presidency_aligned'));
`,
};
