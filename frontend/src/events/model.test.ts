import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DAY, STORIES, beforeAfter, cluster, clusterCell, clusterSize, countByCat, daySteps, fixesBy, fromEonet, fromQuake, geometryNote, markerAt, markerSize, startedBy, endedBy, type EonetEvent, type Ev } from "./model";
import { shownEvents, timeSteps } from "./store";

// The backend's output for five real EONET records (see data/fixtures/README.md), produced by
// `go test` from the same fixture: here the raw records are converted the way the server does.
const raw = JSON.parse(readFileSync(new URL("../../../data/fixtures/eonet_v3_events_5-of-1730_2026-11-14.json", import.meta.url), "utf8")) as {
  events: { id: string; title: string; closed: string | null; categories: { id: string; title: string }[]; sources: { id: string; url: string }[]; link: string;
    geometry: { magnitudeValue: number | null; magnitudeUnit: string | null; date: string; type: string; coordinates: unknown }[] }[] };
function wire(id: string): EonetEvent {
  const r = raw.events.find((e) => e.id === id)!;
  const pts = r.geometry.filter((g) => g.type === "Point").map((g) => ({ lon: (g.coordinates as number[])[0], lat: (g.coordinates as number[])[1], date: g.date, mag: g.magnitudeValue ?? undefined, unit: g.magnitudeUnit ?? undefined }));
  const last = pts[pts.length - 1];
  return { id: r.id, title: r.title, category: r.categories[0].id, category_title: r.categories[0].title, categories: r.categories.map((c) => c.id), closed: r.closed ?? undefined,
    start: r.geometry[0].date, end: r.geometry[r.geometry.length - 1].date, lon: last.lon, lat: last.lat, position: pts.length > 1 ? "latest_reported_point" : "reported_point",
    geometry: pts.length > 1 ? "track" : "point", mag: last.mag, mag_unit: last.unit, track: pts.length > 1 ? pts : undefined, sources: r.sources, link: r.link };
}
const storm = fromEonet(wire("EONET_24317")), fire = fromEonet(wire("EONET_26331")), ice = fromEonet(wire("EONET_25990"));
const point = (id: string, lon: number, lat: number, extra: Partial<Ev> = {}): Ev => ({ id, catalog: "eonet", title: id, cat: "wildfires", categoryTitle: "Wildfires", start: 0, end: 0, lon, lat, position: "reported_point", geometry: "point", sources: [], link: "", ...extra });

describe("catalogue records", () => {
  it("keeps the reported point and metadata of a fire", () => {
    expect([fire.lon, fire.lat]).toEqual([-89.063853, 31.130069]);
    expect(fire).toMatchObject({ cat: "wildfires", geometry: "point", mag: 519, magUnit: "acres", closed: undefined });
    expect(fire.start).toBe(Date.parse("2026-11-12T00:22:00Z"));
  });
  it("files unknown EONET categories under “other” and honours a preferred second category", () => {
    expect(ice.cat).toBe("other");
    expect(ice.categoryTitle).toBe("Sea and Lake Ice");
    const both = { ...wire("EONET_26331"), category: "floods", categories: ["floods", "landslides"] };
    expect(fromEonet(both).cat).toBe("floods");
    expect(fromEonet(both, "landslides").cat).toBe("landslides");
    expect(fromEonet(both, "volcanoes").cat).toBe("floods");
  });
  it("turns a USGS record into an instant point event", () => {
    const q = fromQuake({ id: "us100044k6", lat: 38.2107, lon: 72.7797, depth_km: 22, mag: 7.2, mag_type: "mww", time: "2015-12-07T07:50:05Z", place: "104 km W of Murghob, Tajikistan", status: "reviewed", type: "earthquake", url: "u" });
    expect(q).toMatchObject({ cat: "earthquakes", title: "M 7.2 – 104 km W of Murghob, Tajikistan", depthKm: 22, mag: 7.2, geometry: "point" });
    expect(q.start).toBe(q.end);
    expect(endedBy(q, q.start + 365 * DAY)).toBe(false);
    expect(markerSize(q)).toBeGreaterThan(markerSize({ ...q, mag: 5 }));
  });
});

describe("time", () => {
  it("shows only the positions reported so far and moves the marker to the latest one", () => {
    const tr = storm.track!;
    expect(tr).toHaveLength(24);
    expect(fixesBy(storm, tr[0].t - 1)).toHaveLength(0);
    expect(startedBy(storm, tr[0].t - 1)).toBe(false);
    expect(fixesBy(storm, tr[0].t)).toHaveLength(1);
    expect(fixesBy(storm, tr[9].t + 1)).toHaveLength(10);
    expect(markerAt(storm, tr[9].t)).toMatchObject({ lon: tr[9].lon, lat: tr[9].lat });
    expect(markerAt(storm, tr[23].t + DAY)).toMatchObject({ lon: 150.2, lat: 39, mag: 60, unit: "kts" });
    // Every drawn position is one of the reported ones: nothing in between.
    for (const f of fixesBy(storm, tr[15].t)) expect(tr).toContainEqual(f);
  });
  it("marks an event as ended only after the catalogue closed it", () => {
    expect(endedBy(storm, storm.closed! - 1)).toBe(false);
    expect(endedBy(storm, storm.closed! + 1)).toBe(true);
    expect(endedBy(fire, Date.now() + 10 * DAY)).toBe(false); // still open in the catalogue
  });
  it("steps through whole UTC days and ends exactly at the end", () => {
    const from = Date.parse("2026-10-15T09:30:00Z"), to = Date.parse("2026-11-14T09:30:00Z");
    const s = daySteps(from, to);
    expect(s[0]).toBe(Date.parse("2026-10-16T00:00:00Z"));
    expect(s[s.length - 1]).toBe(to);
    expect(s).toHaveLength(31);
    for (let i = 1; i < s.length - 1; i++) expect(s[i] - s[i - 1]).toBe(DAY);
  });
  it("offers the day before the first date and the day after the last one", () => {
    expect(beforeAfter(storm)).toEqual({ before: "2026-09-15", after: "2026-09-23" });
  });
});

describe("filters", () => {
  const quake = (id: string, mag: number, start: number) => point(id, 0, 0, { cat: "earthquakes", mag, start, end: start, catalog: "usgs" });
  const data = { days: 30 as const, from: 0, to: 100, events: [point("f1", 1, 1, { start: 10, end: 10 }), point("f2", 2, 2, { start: 60, end: 60 }), quake("q5", 5, 20), quake("q7", 7, 30)] };
  const all = { wildfires: true, earthquakes: true, severeStorms: true, floods: true, landslides: true, volcanoes: true, other: true };
  it("filters by kind, magnitude and time", () => {
    const ids = (o: object) => shownEvents({ data, cats: all, minMag: 4.5, cursor: 100, focus: undefined, story: undefined, ...o }).map((e) => e.id);
    expect(ids({})).toEqual(["f1", "f2", "q5", "q7"]);
    expect(ids({ cursor: 25 })).toEqual(["f1", "q5"]);
    expect(ids({ minMag: 6 })).toEqual(["f1", "f2", "q7"]);
    expect(ids({ cats: { ...all, wildfires: false } })).toEqual(["q5", "q7"]);
    expect(countByCat(data.events)).toMatchObject({ wildfires: 2, earthquakes: 2, floods: 0 });
  });
  it("shows a curated record alone, with its own reported times as slider positions", () => {
    const s = { data, cats: all, minMag: 4.5, focus: storm, story: STORIES[0] };
    expect(shownEvents({ ...s, cursor: storm.track![3].t })).toEqual([storm]);
    expect(shownEvents({ ...s, cursor: storm.start - 1 })).toEqual([]);
    expect(timeSteps(s)).toEqual(storm.track!.map((f) => f.t));
    expect(timeSteps({ ...s, focus: fire })).toEqual([]);
  });
});

describe("level of detail", () => {
  it("never moves or merges points when clustering is off", () => {
    const pts = [point("a", 10.1, 10.1), point("b", 10.2, 10.2)];
    expect(cluster(pts, 0)).toEqual([{ lon: 10.1, lat: 10.1, members: [pts[0]] }, { lon: 10.2, lat: 10.2, members: [pts[1]] }]);
  });
  it("merges points of one grid cell at their mean position and keeps every member", () => {
    const pts = [point("a", 10.5, 10.5), point("b", 11.5, 11.5), point("c", 40, -20), point("d", 11, 11)];
    const cl = cluster(pts, 3);
    expect(cl).toHaveLength(2);
    const big = cl.find((c) => c.members.length === 3)!;
    expect(big.members.map((e) => e.id).sort()).toEqual(["a", "b", "d"]);
    expect(big.lon).toBeCloseTo(11, 1); expect(big.lat).toBeCloseTo(11, 1);
    expect(cl.find((c) => c.members.length === 1)).toMatchObject({ lon: 40, lat: -20 }); // a single point is not moved
    expect(cl.reduce((n, c) => n + c.members.length, 0)).toBe(pts.length);
  });
  it("averages across the date line on the sphere", () => {
    const cl = cluster([point("a", 179.5, 0.2), point("b", 179.9, 0.4)], 6);
    expect(cl).toHaveLength(1);
    expect(cl[0].lon).toBeCloseTo(179.7, 1);
  });
  it("uses coarser cells the farther the camera is, none below 2,000 km", () => {
    expect(clusterCell(2.2e7)).toBe(6); expect(clusterCell(5e6)).toBe(3); expect(clusterCell(3e6)).toBe(1.5); expect(clusterCell(1.9e6)).toBe(0);
    expect(clusterSize(1)).toBeLessThan(clusterSize(10)); expect(clusterSize(10)).toBeLessThan(clusterSize(200)); expect(clusterSize(1e6)).toBeLessThanOrEqual(34);
  });
});

describe("wording", () => {
  it("says what the geometry is for every kind of record", () => {
    expect(geometryNote(fire)).toMatch(/one point.*No extent or perimeter/);
    expect(geometryNote(storm)).toMatch(/dated positions.*not a forecast/);
    expect(geometryNote(point("p", 0, 0, { geometry: "polygon", cat: "floods" }))).toMatch(/published an outline/);
    expect(geometryNote(point("q", 0, 0, { cat: "earthquakes" }))).toMatch(/epicentre/);
  });
  it("has curated cases with unique ids and a lookup window for USGS records", () => {
    expect(new Set(STORIES.map((s) => s.id)).size).toBe(STORIES.length);
    for (const s of STORIES) { expect(s.catalog === "usgs" ? !!s.quake : /^EONET_\d+$/.test(s.id)).toBe(true); expect(s.text.length).toBeGreaterThan(40); }
  });
});
