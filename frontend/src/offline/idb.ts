const DB = "earth-explorer";
const VERSION = 1;
let dbP: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbP ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("frames")) db.createObjectStore("frames");
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs");
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => { r.result.close(); dbP = null; };
      resolve(r.result);
    };
    r.onerror = () => { dbP = null; reject(r.error); };
  });
  return dbP;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));

    t.oncomplete = () => resolve(req.result);
    t.onabort = () => reject(t.error ?? new DOMException("Transaction aborted", "AbortError"));
    t.onerror = () => reject(t.error);
    req.onerror = () => reject(req.error);
  }));
}

export const idb = {
  get: <T>(store: string, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: string, key: string, value: unknown) => tx(store, "readwrite", (s) => s.put(value, key)),
  del: (store: string, key: string) => tx(store, "readwrite", (s) => s.delete(key)),
  all: <T>(store: string) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  keys: (store: string) => tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()),
  has: (store: string, key: string) => tx<number>(store, "readonly", (s) => s.count(key)).then((n) => n > 0),
};

export async function storedFrame(url: string): Promise<ArrayBuffer | undefined> {
  try { return await idb.get<ArrayBuffer>("frames", url); } catch { return undefined; }
}

export type BBox = [number, number, number, number];

let regionsP: Promise<BBox[]> | null = null;

export function invalidatePackRegions() { regionsP = null; }

export function packRegions(): Promise<BBox[]> {
  regionsP ??= idb.all<{ bbox?: string; done?: number }>("packs")
    .then((rs) => rs.filter((r) => r.bbox && (r.done ?? 0) > 0).map((r) => r.bbox!.split(",").map(Number) as BBox).filter((b) => b.length === 4 && b.every(Number.isFinite)))
    .catch(() => []);
  return regionsP;
}

export const boxContains = (a: BBox, b: BBox) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3] && b[0] < b[2];
export const boxIntersects = (a: BBox, b: BBox) => b[0] < b[2] && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
