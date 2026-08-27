import { sqlite } from './client.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS proxies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    extra TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    last_test_at TEXT,
    last_test TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    proxy_id TEXT,
    timezone TEXT NOT NULL,
    home_url TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS access_grants (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, target_id)
  )`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    actor_id TEXT,
    actor_username TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    ip TEXT,
    success INTEGER NOT NULL,
    detail TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grants_target ON access_grants(kind, target_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grants_user ON access_grants(user_id)`,
  `CREATE TABLE IF NOT EXISTS session_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_groups_parent ON session_groups(parent_id)`,
];

function tableColumns(table: string) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(table: string, column: string, spec: string) {
  if (tableColumns(table).has(column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${spec}`);
}

export function migrate() {
  sqlite.exec('BEGIN');
  try {
    for (const sql of STATEMENTS) sqlite.exec(sql);
    ensureColumn('sessions', 'group_id', 'TEXT');
    ensureColumn('sessions', 'idle_timeout_minutes', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('sessions', 'chrome_language', "TEXT NOT NULL DEFAULT 'zh-CN'");
    ensureColumn('proxies', 'extra', "TEXT NOT NULL DEFAULT '{}'");
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id)');
    sqlite.exec('DROP TABLE IF EXISTS session_assignments');
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}
