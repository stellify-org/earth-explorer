import { apiURL } from "../api/url";
export const SNAPSHOTS = "ee-snapshot-packs";
export interface Snapshot {
  url: string; title: string; kind: "trend" | "earthquakes";
  params: Record<string, string | number>; saved: string; bytes: number; sha256: string;
}
const digest = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function saveSnapshot(path: string, params: Snapshot["params"], data: unknown, title: string, kind: Snapshot["kind"]) {
  const url = apiURL(path, params);
  const body = new TextEncoder().encode(JSON.stringify(data));
  const record: Snapshot = { url, title, kind, params, saved: new Date().toISOString(), bytes: body.byteLength, sha256: await digest(body.buffer) };
  await (await caches.open(SNAPSHOTS)).put(url, new Response(body, { headers: { "Content-Type": "application/json", "X-EE-Snapshot": encodeURIComponent(JSON.stringify(record)) } }));
  return record;
}
export async function readSnapshot(url: string): Promise<Response | undefined> {
  try {
    const response = await (await caches.open(SNAPSHOTS)).match(url, { ignoreVary: true });
    if (!response) return undefined;
    const record = JSON.parse(decodeURIComponent(response.headers.get("X-EE-Snapshot") ?? "")) as Snapshot;
    if (await digest(await response.clone().arrayBuffer()) !== record.sha256) return undefined;
    return response;
  } catch { return undefined; }
}
export async function listSnapshots(): Promise<Snapshot[]> {
  try {
    const c = await caches.open(SNAPSHOTS);
    const rows = await Promise.all((await c.keys()).map(async (key) => {
      try { return JSON.parse(decodeURIComponent((await c.match(key))!.headers.get("X-EE-Snapshot")!)) as Snapshot; } catch { return undefined; }
    }));
    return rows.filter((r): r is Snapshot => !!r).sort((a, b) => b.saved.localeCompare(a.saved));
  } catch { return []; }
}
export async function deleteSnapshot(url: string) { await (await caches.open(SNAPSHOTS)).delete(url); }
