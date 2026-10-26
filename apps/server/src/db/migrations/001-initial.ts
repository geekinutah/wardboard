import type { Migration } from '../types.ts';

// Composite UNIQUE (id, board_id) keys exist so a foreign key can reference
// them. SQLite accepts only an exact PRIMARY KEY or UNIQUE parent key, and
// the extra board_id column keeps a child from pointing at another board.
export const initialMigration: Migration = {
  id: 1,
  name: 'initial',
  up: `
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  photo_ref TEXT,
  category TEXT NOT NULL CHECK (category IN ('adult', 'youth')),
  note TEXT CHECK (note IS NULL OR length(note) <= 280),
  needs_approval INTEGER NOT NULL DEFAULT 0 CHECK (needs_approval IN (0, 1)),
  removed_date TEXT CHECK (
    removed_date IS NULL
    OR (
      length(removed_date) = 10
      AND removed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE member_tags (
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, tag_id)
);

CREATE TABLE external_callings (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  title TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'admin')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  invited_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('current', 'proposal', 'baseline')),
  name TEXT NOT NULL,
  status TEXT,
  rationale TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  tab_order INTEGER,
  accepted_by TEXT REFERENCES users (id),
  accepted_at TEXT,
  accepted_summary TEXT,
  baseline_board_id TEXT REFERENCES boards (id),
  import_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'proposal' AND status IN ('draft', 'accepted'))
    OR (kind <> 'proposal' AND status IS NULL)
  ),
  CHECK (
    (kind = 'proposal' AND baseline_board_id IS NOT NULL)
    OR (kind <> 'proposal' AND baseline_board_id IS NULL)
  )
);

CREATE UNIQUE INDEX boards_one_current ON boards (kind) WHERE kind = 'current';

CREATE TABLE board_groups (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  UNIQUE (id, board_id)
);

CREATE TABLE calling_groups (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  board_group_id TEXT,
  parent_calling_group_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE (id, board_id),
  CHECK (
    (board_group_id IS NOT NULL AND parent_calling_group_id IS NULL)
    OR (board_group_id IS NULL AND parent_calling_group_id IS NOT NULL)
  ),
  FOREIGN KEY (board_group_id, board_id) REFERENCES board_groups (id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_calling_group_id, board_id) REFERENCES calling_groups (id, board_id) ON DELETE CASCADE
);

CREATE TABLE calling_assignments (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  calling_group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single', 'list')),
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  prominence INTEGER NOT NULL DEFAULT 0 CHECK (prominence >= 0),
  origin TEXT NOT NULL CHECK (origin IN ('standard', 'custom')),
  UNIQUE (id, board_id),
  FOREIGN KEY (calling_group_id, board_id) REFERENCES calling_groups (id, board_id) ON DELETE CASCADE
);

CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE (id, board_id),
  UNIQUE (id, assignment_id, board_id),
  UNIQUE (board_id, lineage_id),
  FOREIGN KEY (assignment_id, board_id) REFERENCES calling_assignments (id, board_id) ON DELETE CASCADE
);

CREATE TABLE placements (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members (id),
  UNIQUE (position_id),
  UNIQUE (assignment_id, member_id),
  UNIQUE (board_id, member_id, position_id),
  FOREIGN KEY (position_id, assignment_id, board_id)
    REFERENCES positions (id, assignment_id, board_id) ON DELETE CASCADE
);

CREATE TABLE oversight (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  target_board_group_id TEXT,
  target_calling_group_id TEXT,
  fixed INTEGER NOT NULL CHECK (fixed IN (0, 1)),
  CHECK (
    (target_board_group_id IS NOT NULL AND target_calling_group_id IS NULL)
    OR (target_board_group_id IS NULL AND target_calling_group_id IS NOT NULL)
  ),
  FOREIGN KEY (position_id, board_id) REFERENCES positions (id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (target_board_group_id, board_id) REFERENCES board_groups (id, board_id) ON DELETE CASCADE,
  FOREIGN KEY (target_calling_group_id, board_id) REFERENCES calling_groups (id, board_id) ON DELETE CASCADE
);

CREATE TABLE calling_tags (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, tag_id),
  FOREIGN KEY (assignment_id, board_id) REFERENCES calling_assignments (id, board_id) ON DELETE CASCADE
);

CREATE TABLE calling_affinities (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, tag_id),
  FOREIGN KEY (assignment_id, board_id) REFERENCES calling_assignments (id, board_id) ON DELETE CASCADE
);

CREATE TABLE dugout_inclusions (
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members (id),
  PRIMARY KEY (board_id, member_id)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  approver_user_id TEXT NOT NULL REFERENCES users (id),
  approved_at TEXT NOT NULL,
  UNIQUE (board_id, member_id, position_id),
  FOREIGN KEY (board_id, member_id, position_id)
    REFERENCES placements (board_id, member_id, position_id) ON DELETE CASCADE
);
`,
};
