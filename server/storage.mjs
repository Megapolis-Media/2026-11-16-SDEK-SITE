import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const stateKey = Symbol.for('cdek-fm.sqlite');

export function database() {
  const directory = path.resolve(process.env.CDEK_DATA_DIR || 'data');
  const filename = path.join(directory, 'cdek.sqlite');
  if (globalThis[stateKey]) {
    if (globalThis[stateKey].filename !== filename) throw new Error('Database path changed during execution');
    return globalThis[stateKey].connection;
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const connection = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  connection.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  globalThis[stateKey] = { filename, connection };
  return connection;
}

// D1 uses numbered SQLite parameters; expand repeated indexes for node:sqlite.
function parameters(sql, values) {
  const indexed = [];
  const text = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/|\?(\d+)/g,
    (match, index) => {
      if (!index) return match;
      indexed.push(values[Number(index) - 1]);
      return '?';
    });
  return { sql: text, values: indexed.length ? indexed : values };
}

class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  execute() {
    const input = parameters(this.sql, this.values);
    const db = database();
    const started = performance.now();
    const before = db.prepare('SELECT total_changes() AS value').get().value;
    const results = db.prepare(input.sql).all(...input.values);
    const state = db.prepare('SELECT total_changes() AS value, last_insert_rowid() AS id').get();
    return { success: true, results, meta: {
      duration: performance.now() - started, changes: state.value - before,
      last_row_id: state.id, changed_db: state.value !== before,
      size_after: 0, rows_read: results.length, rows_written: state.value - before,
    } };
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first(column) {
    const row = this.execute().results[0];
    return row ? (column === undefined ? row : row[column] ?? null) : null;
  }
  async raw() { return this.execute().results.map(row => Object.values(row)); }
}

export const localDB = {
  prepare(sql) { return new Statement(sql); },
  async batch(statements) {
    const db = database();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(statement => statement.execute());
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  },
};

export function migrate(directory = 'drizzle') {
  const db = database();
  db.exec('CREATE TABLE IF NOT EXISTS _cdek_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const applied = new Map(db.prepare('SELECT name, checksum FROM _cdek_migrations').all().map(row => [row.name, row.checksum]));
  for (const name of readdirSync(directory).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
    const sql = readFileSync(path.join(directory, name), 'utf8');
    const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) throw new Error(`Applied migration has changed: ${name}`);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _cdek_migrations VALUES (?, ?, ?)').run(name, checksum, Date.now());
      db.exec('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
}

function objectPath(key) {
  const directory = path.resolve(process.env.CDEK_DATA_DIR || 'data', 'uploads');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, createHash('sha256').update(key).digest('hex'));
}

export const localBucket = {
  async put(key, value) {
    const filename = objectPath(key);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, Buffer.from(value), { mode: 0o600, flag: 'wx' });
      await rename(temporary, filename);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  },
  async get(key) {
    let bytes;
    try { bytes = await readFile(objectPath(key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    return { body: new Uint8Array(bytes), size: bytes.length,
      httpEtag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' };
  },
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      await unlink(objectPath(key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  },
};
