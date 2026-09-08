import { vi } from "vitest";

/** Minimal in-memory `localStorage` double for unit tests. */
export function stubStorage(existing: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(existing));
  const storage = {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => void map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  };
  return storage as unknown as Storage;
}

/** Install the storage stub and return a restore handle. */
export function installStorage(existing: Record<string, string> = {}): Storage {
  const storage = stubStorage(existing);
  vi.stubGlobal("localStorage", storage);
  return storage;
}
