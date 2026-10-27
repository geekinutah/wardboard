import type { Migration } from '../types.ts';

// Oversight is rebuilt so position_id can be nullable. The table is renamed
// back to oversight; no table name is added or dropped.
export const boardPersistenceMigration: Migration = {
  id: 2,
  name: 'board-persistence',
  up: `
ALTER TABLE boards ADD COLUMN proposal_id TEXT;
CREATE UNIQUE INDEX boards_proposal_id ON boards (proposal_id) WHERE proposal_id IS NOT NULL;

ALTER TABLE board_groups ADD COLUMN group_key TEXT;

ALTER TABLE calling_groups ADD COLUMN kind TEXT NOT NULL DEFAULT 'other'
  CHECK (kind IN ('presidency', 'bishopric', 'quorum', 'class', 'committee', 'other'));
ALTER TABLE calling_groups ADD COLUMN group_key TEXT;

ALTER TABLE calling_assignments ADD COLUMN leadership_role TEXT
  CHECK (leadership_role IS NULL OR leadership_role IN ('president', 'counselor', 'secretary'));

ALTER TABLE member_tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE external_callings ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calling_tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calling_affinities ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dugout_inclusions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE oversight_new (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position_id TEXT,
  target_board_group_id TEXT,
  target_calling_group_id TEXT,
  fixed INTEGER NOT NULL CHECK (fixed IN (0, 1)),
  overseer TEXT CHECK (overseer IS NULL OR overseer IN ('bishop', 'first_counselor', 'second_counselor')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (
    (target_board_group_id IS NOT NULL AND target_calling_group_id IS NULL)
    OR (target_board_group_id IS NULL AND target_calling_group_id IS NOT NULL)
  ),
  CHECK (position_id IS NOT NULL OR overseer IS NOT NULL),
  FOREIGN KEY (position_id, board_id) REFERENCES positions (id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (target_board_group_id, board_id) REFERENCES board_groups (id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (target_calling_group_id, board_id) REFERENCES calling_groups (id, board_id) ON DELETE CASCADE
);

INSERT INTO oversight_new (
  id, board_id, position_id, target_board_group_id, target_calling_group_id, fixed, overseer, sort_order
)
SELECT
  id, board_id, position_id, target_board_group_id, target_calling_group_id, fixed, NULL, 0
FROM oversight;

DROP TABLE oversight;
ALTER TABLE oversight_new RENAME TO oversight;
`,
};
