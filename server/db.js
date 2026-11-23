/**
 * SQLite database connection & schema.
 *
 * Tries `better-sqlite3` first (native, fast). If it cannot be loaded — e.g. on a checkout
 * without a C/Python build chain — it falls back to `SimpleDB`, a pure-JS in-memory store that
 * understands the subset of SQL this server actually uses. The fallback persists tables to a
 * JSON sidecar next to the database path so a restart doesn't wipe saves and leaderboard rows.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

/* ---------------------------------------------------------------------------
 * Pure-JS fallback: handles the exact SQL subset the routes use.
 * --------------------------------------------------------------------------*/

function q(sql) {
  return String(sql).trim();
}

function paramsOf(stmt, supplied) {
  const idxs = [];
  let i = 0;
  for (const ch of stmt.sql) {
    if (ch === '?') idxs.push(i++);
  }
  return idxs.map((k) => supplied[k]);
}

class SimpleStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = q(sql);
  }

  /** INSERT / INSERT ... ON CONFLICT ... DO UPDATE ... / DELETE */
  run(...supplied) {
    const sql = this.sql;
    const p = paramsOf(this, supplied);

    // --- INSERT INTO t (cols) VALUES (?, ?, ?) ---------------------------------
    const ins = sql.match(
      /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)\s*$/i
    );
    if (ins) {
      const table = ins[1];
      const cols = ins[2].split(',').map((c) => c.trim());
      const row = {};
      cols.forEach((c, i) => { row[c] = p[i]; });
      this.db.insert(table, row);
      return { changes: 1 };
    }

    // --- INSERT INTO t (cols) VALUES (...) ON CONFLICT(col) DO UPDATE SET ... [WHERE ...] ---
    const up = sql.match(
      /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\([^)]*\)\s+ON\s+CONFLICT\s*\((\w+)\)\s+DO\s+UPDATE\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?\s*$/i
    );
    if (up) {
      const table = up[1];
      const cols = up[2].split(',').map((c) => c.trim());
      const conflictCol = up[3];
      const setClause = up[4];
      const whereClause = up[5];
      const insertRow = {};
      cols.forEach((c, i) => { insertRow[c] = p[i]; });

      const existing = this.db.findOne(table, (r) => r[conflictCol] === insertRow[conflictCol]);
      if (existing) {
        let apply = true;
        if (whereClause) {
          const m = whereClause.match(
            /excluded\.(\w+)\s*>=\s*(\w+)\.(\w+)/i
          );
          if (m) {
            const excludedCol = m[1];
            const tableCol = m[3];
            apply = (insertRow[excludedCol] || 0) >= (existing[tableCol] || 0);
          }
        }
        if (apply) {
          setClause.split(',').forEach((assign) => {
            const mm = assign.match(/(\w+)\s*=\s*excluded\.(\w+)/i);
            if (mm) existing[mm[1]] = insertRow[mm[2]];
          });
          this.db.update(table, existing);
        }
        return { changes: apply ? 1 : 0 };
      }
      this.db.insert(table, insertRow);
      return { changes: 1 };
    }

    // --- DELETE FROM t WHERE col = ? ------------------------------------------
    const del = sql.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i);
    if (del) {
      const removed = this.db.deleteWhere(del[1], del[2], p[0]);
      return { changes: removed };
    }

    return { changes: 0 };
  }

  /** SELECT ... WHERE col = ? — returns first row or undefined. */
  get(...supplied) {
    const sql = this.sql;
    const p = paramsOf(this, supplied);

    const sel = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?\s*$/i);
    if (sel) {
      const cols = sel[1].split(',').map((c) => c.trim());
      const table = sel[2];
      const col = sel[3];
      const row = this.db.findOne(table, (r) => r[col] === p[0]);
      if (!row) return undefined;
      if (cols.includes('*')) return row;
      const picked = {};
      cols.forEach((c) => { picked[c] = row[c]; });
      return picked;
    }
    return undefined;
  }

  /** SELECT ... ORDER BY ... LIMIT N — returns all rows. */
  all(..._supplied) {
    const sql = this.sql;

    const sel = sql.match(
      /^SELECT\s+(.+?)\s+FROM\s+(\w+)\s+ORDER\s+BY\s+(.+?)\s+LIMIT\s+(\d+)\s*$/i
    );
    if (sel) {
      const cols = sel[1].split(',').map((c) => c.trim());
      const table = sel[2];
      const orderBy = sel[3];
      const limit = Number(sel[4]);
      const rows = this.db.findAll(table);
      rows.sort((a, b) => {
        const keys = orderBy.split(',').map((k) => k.trim());
        for (const key of keys) {
          const desc = key.toLowerCase().endsWith(' desc');
          const k = key.replace(/\s+desc$/i, '').trim();
          const av = a[k]; const bv = b[k];
          if (av < bv) return desc ? 1 : -1;
          if (av > bv) return desc ? -1 : 1;
        }
        return 0;
      });
      if (cols.includes('*')) return rows.slice(0, limit);
      return rows.map((r) => {
        const picked = {};
        cols.forEach((c) => { picked[c] = r[c]; });
        return picked;
      }).slice(0, limit);
    }
    return [];
  }
}

class SimpleDB {
  constructor(path, fs) {
    this.path = path;
    this.fs = fs;
    this.tables = {};
    this.load();
  }

  load() {
    try {
      if (this.fs.existsSync(this.path)) {
        const raw = JSON.parse(this.fs.readFileSync(this.path, 'utf8'));
        this.tables = raw.tables || {};
      }
    } catch {
      /* start fresh */
    }
  }

  save() {
    try {
      this.fs.writeFileSync(this.path, JSON.stringify({ tables: this.tables }, null, 2));
    } catch {
      /* persistence is best-effort */
    }
  }

  table(name) {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  insert(name, row) {
    this.table(name).push(row);
    this.save();
  }

  findOne(name, fn) {
    return this.table(name).find(fn);
  }

  findAll(name) {
    return this.table(name).slice();
  }

  update(name, row) {
    const t = this.table(name);
    const idx = t.findIndex((r) => r.id === row.id);
    if (idx >= 0) t[idx] = row;
    this.save();
  }

  deleteWhere(name, col, val) {
    const t = this.table(name);
    const before = t.length;
    this.tables[name] = t.filter((r) => r[col] !== val);
    this.save();
    return before - this.tables[name].length;
  }

  exec(sql) {
    const m = String(sql).match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i);
    if (m) this.table(m[1]);
  }

  prepare(sql) {
    return new SimpleStatement(this, sql);
  }

  pragma() {
    /* no-op for the fallback */
  }
}

/* ---------------------------------------------------------------------------
 * Connection: try better-sqlite3, fall back to SimpleDB.
 * --------------------------------------------------------------------------*/

let db;
let dbKind = 'none';

try {
  const Database = require('better-sqlite3');
  const databasePath = resolve(process.env.DATABASE_PATH || 'blitzball.db');
  db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  dbKind = 'better-sqlite3';
} catch {
  /* fall through to SimpleDB below */
}

if (!db) {
  const { existsSync, readFileSync, writeFileSync } = require('node:fs');
  const databasePath = resolve(process.env.DATABASE_PATH || 'blitzball.db');
  db = new SimpleDB(databasePath, { existsSync, readFileSync, writeFileSync });
  dbKind = 'simple';
}

export default db;
export { dbKind };
