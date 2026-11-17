import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, copyFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { database, localDB, localBucket, migrate } from '../server/storage.mjs';

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
