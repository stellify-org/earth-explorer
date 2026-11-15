/** Small in-memory Cache Storage double; real browser coverage lives in tests/e2e. */
export function cacheStorage() {
  const key = (r: Request | string) => { const u = new URL(typeof r === "string" ? r : r.url, "https://earth.test"); u.hash = ""; return u.href; };
  class Bucket {
    entries = new Map<string, Response>();
    scans = 0;
    failWrites = false;
    async match(r: Request | string) { return this.entries.get(key(r))?.clone(); }
    async put(r: Request | string, response: Response) {
      if (this.failWrites) throw new DOMException("full", "QuotaExceededError");
      this.entries.set(key(r), response.clone());
    }
    async keys() { this.scans++; return [...this.entries.keys()].map((u) => new Request(u)); }
    async delete(r: Request | string) { return this.entries.delete(key(r)); }
  }
  const buckets = new Map<string, Bucket>();
  return {
    async open(name: string) { let b = buckets.get(name); if (!b) { b = new Bucket(); buckets.set(name, b); } return b; },
    async keys() { return [...buckets.keys()]; },
    async delete(name: string) { return buckets.delete(name); },
    async match(r: Request | string) { for (const b of buckets.values()) { const hit = await b.match(r); if (hit) return hit; } },
  };
}
