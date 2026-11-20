import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyStore } from './domain.mjs';
import { readLocalStore, writeLocalStore, STORAGE_KEY } from './storage.mjs';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('a fresh workspace and an old installation both open with no sample records', () => {
  const storage = memoryStorage({ 'smart-document-workflow-v1': '{"legacy":"preserved"}' });
  const loaded = readLocalStore(storage);
  assert.deepEqual(loaded.store, createEmptyStore());
  assert.equal(loaded.blocked, false);
  assert.equal(storage.getItem('smart-document-workflow-v1'), '{"legacy":"preserved"}');
});

test('saved workspace round trips through validated persistence', () => {
  const storage = memoryStorage();
  assert.deepEqual(writeLocalStore(storage, createEmptyStore()), { error: null });
  assert.deepEqual(readLocalStore(storage).store, createEmptyStore());
});

test('corrupt saved data blocks automatic persistence and is not silently replaced', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not-json' });
  const loaded = readLocalStore(storage);
  assert.equal(loaded.blocked, true);
  assert.ok(loaded.error);
  assert.equal(storage.getItem(STORAGE_KEY), '{not-json');
});

test('nested invalid records are rejected without mutating the stored data', () => {
  const bad = JSON.stringify({ ...createEmptyStore(), quotes: [{}] });
  const storage = memoryStorage({ [STORAGE_KEY]: bad });
  assert.equal(readLocalStore(storage).blocked, true);
  assert.equal(storage.getItem(STORAGE_KEY), bad);
});

test('unavailable storage and quota errors produce actionable errors instead of crashing', () => {
  const unavailable = () => { throw new Error('Storage disabled'); };
  assert.equal(readLocalStore(unavailable).blocked, true);
  assert.ok(writeLocalStore(unavailable, createEmptyStore()).error);
  const quota = { setItem() { throw new Error('Quota'); } };
  assert.ok(writeLocalStore(quota, createEmptyStore()).error);
});

test('invalid in-memory state is not written over a valid backup', () => {
  const storage = memoryStorage();
  writeLocalStore(storage, createEmptyStore());
  const original = storage.getItem(STORAGE_KEY);
  assert.ok(writeLocalStore(storage, { ...createEmptyStore(), settings: { defaultVat: 999 } }).error);
  assert.equal(storage.getItem(STORAGE_KEY), original);
});
