import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, copyFileSync, appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { database, localDB, localBucket, createLocalBucket, photoStorageQuotaBytes, migrate } from '../server/storage.mjs';
import { spawn } from 'node:child_process';

mkdirSync('work', { recursive: true });
const directory = mkdtempSync(path.resolve('work/storage-test-'));
process.env.CDEK_DATA_DIR = directory;
after(() => database().close());

test('real application migrations can run repeatedly without losing stored messages', async () => {
  migrate();
  await localDB.prepare('INSERT INTO chat_message (id, client_key, body, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind('test-message', 'client', 'Сохранённое сообщение', 1234).run();
  migrate();
  assert.equal(await localDB.prepare('SELECT body FROM chat_message WHERE id = ?').bind('test-message').first('body'), 'Сохранённое сообщение');
  const changed = path.join(directory, 'changed-migrations');
  mkdirSync(changed);
  copyFileSync('drizzle/0000_nifty_strong_guy.sql', path.join(changed, '0000_nifty_strong_guy.sql'));
  appendFileSync(path.join(changed, '0000_nifty_strong_guy.sql'), '\n-- changed\n');
  assert.throws(() => migrate(changed), /Applied migration has changed/);
});

test('numbered bindings retain repeated values and RETURNING results', async () => {
  const row = await localDB.prepare("SELECT ?2 AS second, ?1 AS first, ?2 AS repeated, '?1' AS literal")
    .bind('один', 'два').first();
  assert.equal(row.second, 'два');
  assert.equal(row.first, 'один');
  assert.equal(row.repeated, 'два');
  assert.equal(row.literal, '?1');
  const removed = await localDB.prepare('DELETE FROM chat_message WHERE id = ? RETURNING id').bind('test-message').all();
  assert.equal(removed.results[0].id, 'test-message');
});

test('SQLite and its directory are private to the application owner', { skip: process.platform === 'win32' }, () => {
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(directory, 'cdek.sqlite')).mode & 0o777, 0o600);
});

test('the track limit migration preserves old requests and remains compatible with the previous writer', () => {
  const legacy = new DatabaseSync(':memory:');
  try {
    for (const filename of readdirSync('drizzle').filter(name => /^000[0-4]_.*\.sql$/.test(name)).sort()) {
      legacy.exec(readFileSync(path.join('drizzle', filename), 'utf8'));
    }
    const oldInsert = 'INSERT INTO track_request (id, author_key, author_name, title, artist, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
    legacy.prepare(oldInsert).run('old-track', 'guest', 'Guest', 'Keep this song', '', 'before', 123);
    legacy.exec(readFileSync('drizzle/0005_track_client_limit.sql', 'utf8'));
    assert.equal(legacy.prepare('SELECT title FROM track_request WHERE id = ?').get('old-track').title, 'Keep this song');
    assert.equal(legacy.prepare('SELECT client_key FROM track_request WHERE id = ?').get('old-track').client_key, null);
    legacy.prepare(oldInsert).run('rollback-track', 'guest', 'Guest', 'Old writer still works', '', 'before', 124);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM track_request').get().count, 2);
  } finally { legacy.close(); }
});

test('a failed batch rolls back earlier writes', async () => {
  await assert.rejects(localDB.batch([
    localDB.prepare('INSERT INTO chat_moderation VALUES (1, 5)'),
    localDB.prepare('INSERT INTO missing_table VALUES (1)'),
  ]));
  assert.equal(await localDB.prepare('SELECT revision FROM chat_moderation WHERE id = 1').first(), null);
  const result = await localDB.batch([
    localDB.prepare('INSERT INTO chat_moderation VALUES (1, 7)'),
    localDB.prepare('SELECT revision FROM chat_moderation WHERE id = 1'),
  ]);
  assert.equal(result[1].results[0].revision, 7);
});

test('attachments survive replacement, have content etags and safely accept path-like keys', async () => {
  const key = '../../outside-the-upload-directory';
  await localBucket.put(key, new Uint8Array([1, 2, 3]));
  const first = await localBucket.get(key);
  assert.equal(first.size, 3);
  assert.deepEqual([...first.body], [1, 2, 3]);
  await localBucket.put(key, new Uint8Array([4]));
  assert.notEqual((await localBucket.get(key)).httpEtag, first.httpEtag);
  await localBucket.delete([key, 'absent']);
  assert.equal(await localBucket.get(key), null);
});

test('photo quota uses actual bytes, permits exact capacity and releases successfully deleted files', async () => {
  assert.equal(photoStorageQuotaBytes, 21_474_836_480);
  const bucket = createLocalBucket({ quotaBytes: 5, minimumFreeBytes: 0 });
  try {
    await bucket.put('quota-a', new Uint8Array([1, 2, 3]));
    await bucket.put('quota-b', new Uint8Array([4, 5]));
    await assert.rejects(bucket.put('quota-c', new Uint8Array([6])), { code: 'CDEK_PHOTO_STORAGE_FULL' });
    assert.equal(await bucket.get('quota-c'), null);
    assert.equal((await bucket.get('quota-a')).size, 3);
    await bucket.put('quota-a', new Uint8Array([1]));
    await bucket.put('quota-c', new Uint8Array([6, 7]));
    await bucket.delete('quota-b');
    await bucket.put('quota-d', new Uint8Array([8, 9]));
    assert.equal(database().prepare('SELECT bytes FROM local_upload_usage').get().bytes, 5);
  } finally { await bucket.delete(['quota-a', 'quota-b', 'quota-c', 'quota-d']); }
});

test('restarting storage accounts for legacy and orphan files before allowing another upload', async () => {
  await localBucket.put('legacy-image', new Uint8Array([1, 2, 3]));
  database().prepare('UPDATE local_upload_usage SET bytes = 0').run();
  const restarted = createLocalBucket({ quotaBytes: 3, minimumFreeBytes: 0 });
  try {
    await assert.rejects(restarted.put('new-image', new Uint8Array([4])), { code: 'CDEK_PHOTO_STORAGE_FULL' });
    assert.deepEqual([...(await restarted.get('legacy-image')).body], [1, 2, 3]);
  } finally { await restarted.delete(['legacy-image', 'new-image']); }
});

test('low free disk reserve rejects photo writes without preventing existing image reads', async () => {
  await localBucket.put('disk-reserve-image', new Uint8Array([1]));
  const bucket = createLocalBucket({ diskStat: () => ({ bavail: 1, bsize: 1 }) });
  try {
    await assert.rejects(bucket.put('disk-full-image', new Uint8Array([2])), { code: 'CDEK_PHOTO_STORAGE_FULL' });
    assert.equal((await bucket.get('disk-reserve-image')).size, 1);
  } finally { await bucket.delete(['disk-reserve-image', 'disk-full-image']); }
});

test('independent upload processes cannot simultaneously exceed a shared disk quota', async () => {
  const program = `import { createLocalBucket, database } from './server/storage.mjs';
    try { await createLocalBucket({quotaBytes: 5, minimumFreeBytes: 0}).put(process.argv[1], new Uint8Array([1,2,3])); }
    catch (error) { if (error.code !== 'CDEK_PHOTO_STORAGE_FULL') throw error; process.exitCode = 2; }
    finally { database().close(); }`;
  const run = key => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, key], { env: process.env, windowsHide: true });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    child.on('error', reject);
    child.on('exit', code => [0, 2].includes(code) ? resolve(code) : reject(new Error(errors)));
  });
  try {
    const results = await Promise.all([run('parallel-a'), run('parallel-b')]);
    assert.deepEqual(results.sort(), [0, 2]);
    const files = readdirSync(path.join(directory, 'uploads'));
    assert.equal(files.reduce((total, file) => total + statSync(path.join(directory, 'uploads', file)).size, 0), 3);
  } finally { await createLocalBucket().delete(['parallel-a', 'parallel-b']); }
});

test('photo migration counts earlier images and deletion does not refund the daily allowance', () => {
  const legacy = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('drizzle').filter(name => /^000[0-5]_.*\.sql$/.test(name)).sort()) {
      legacy.exec(readFileSync(path.join('drizzle', file), 'utf8'));
    }
    const insert = legacy.prepare('INSERT INTO chat_message (id, client_key, author_key, body, created_at, image_key) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 3; i++) insert.run('legacy-' + i, 'network', 'author', '', 1000, 'photo-' + i);
    legacy.exec(readFileSync('drizzle/0006_photo_limits.sql', 'utf8'));
    legacy.exec('DELETE FROM chat_message');
    assert.throws(() => insert.run('fourth', 'network', 'author', '', 1000, 'fourth-photo'), /CDEK_PHOTO_DAILY_LIMIT/);
    insert.run('next-day', 'network', 'author', '', 86_400_000, 'next-photo');
    insert.run('text-only', 'network', 'author', 'Text is allowed', 1000, null);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM chat_message').get().count, 2);
  } finally { legacy.close(); }
});
