import { createEmptyStore, normalizeStore } from './domain.mjs';

// A new namespace starts clean without deleting a user's older local installation.
export const STORAGE_KEY = 'smart-document-workflow-v2';

const resolveStorage = (storage) => typeof storage === 'function' ? storage() : storage;

export function readLocalStore(storage) {
  try {
    const raw = resolveStorage(storage).getItem(STORAGE_KEY);
    if (raw === null) return { store: createEmptyStore(), error: null, blocked: false };
    return { store: normalizeStore(JSON.parse(raw)), error: null, blocked: false };
  } catch {
    // Never replace unreadable user data with an empty store in a later effect.
    return {
      store: createEmptyStore(),
      error: 'อ่านข้อมูลเดิมไม่ได้ หรือเบราว์เซอร์ไม่อนุญาตพื้นที่จัดเก็บ',
      blocked: true,
    };
  }
}

export function writeLocalStore(storage, store) {
  try {
    const normalized = normalizeStore(store);
    resolveStorage(storage).setItem(STORAGE_KEY, JSON.stringify(normalized));
    return { error: null };
  } catch {
    return { error: 'บันทึกในเบราว์เซอร์ไม่สำเร็จ กรุณาส่งออก JSON ก่อนปิดหน้าเว็บ' };
  }
}
