import { useMemo } from "react";
import {
  GeographicTilingScheme, UrlTemplateImageryProvider,
} from "@cesium/engine";
import type { Layer } from "../api/types";
import { useLowBandwidth, useStore } from "../store";
import { hillshadeProvider } from "./terrain";
import { geo } from "../geo";
import { VectorImageryProvider, asProvider } from "../geo/VectorImageryProvider";
import type { GlobeLayerSpec } from "./GlobeView";
import { gibsProvider } from "./gibs";
import { useAvailability } from "./useAvailability";

function reliefProvider() {
  return new UrlTemplateImageryProvider({
    url: "/cesium/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg",
    tilingScheme: new GeographicTilingScheme(),
    maximumLevel: 2,
  });
}

const NONE: GlobeLayerSpec[] = [];

export function useGlobeLayers(satelliteId: string | undefined, vizId: string | undefined, date: string, numeric: GlobeLayerSpec[] = NONE, suppressLines = false, xray = false) {
  const { layers, vizOpacity, baseStyle, showCoastlines, showBorders, showRivers, terrain, reliefShading } = useStore();
  const low = useLowBandwidth();
  const shading = reliefShading && (terrain || (xray && !low));
  const find = (id?: string): Layer | undefined => layers.find((l) => l.id === id);
  const sat = find(satelliteId);
  const viz = find(vizId);
  const satAv = useAvailability(sat, date, true);
  const vizAv = useAvailability(viz, date, true);
  const satBefore = !!satAv.a && satAv.a.requested < satAv.a.first;
  const vizBefore = !!vizAv.a && vizAv.a.requested < vizAv.a.first;

  const specs = useMemo(() => {
    const out: GlobeLayerSpec[] = [];
    out.push(baseStyle === "relief"
      ? { key: "base-relief", provider: reliefProvider }
      : { key: "base-vector", provider: () => asProvider(new VectorImageryProvider(geo, "base")) });
    const satShown = sat && (!sat.time_enabled || (satAv.a && !satBefore));
    if (satShown) {

      if (sat.time_enabled) out.push({ key: "nodata-hatch", provider: () => asProvider(new VectorImageryProvider(geo, "nodata", 8)) });
      const d = satAv.a?.shown;

      out.push({ key: `sat|${sat.id}|${d ?? ""}`, provider: () => gibsProvider(sat, d), blackToAlpha: sat.time_enabled && sat.format === "image/jpeg" ? 0.06 : undefined });
    }
    if (viz && (!viz.time_enabled || (vizAv.a && !vizBefore))) {
      const d = vizAv.a?.shown;
      out.push({ key: `viz|${viz.id}|${d ?? ""}`, provider: () => gibsProvider(viz, d), opacity: vizOpacity });
    }
    if (shading) out.push({ key: "hillshade", provider: hillshadeProvider });
    out.push(...numeric);

    if (suppressLines) return out;
    if (showCoastlines) out.push({ key: "coast", provider: () => asProvider(new VectorImageryProvider(geo, "coast")) });
    if (showRivers) out.push({ key: "rivers", provider: () => asProvider(new VectorImageryProvider(geo, "rivers")) });
    if (showBorders) out.push({ key: "borders", provider: () => asProvider(new VectorImageryProvider(geo, "borders")) });
    return out;
  }, [sat, viz, satAv.a?.shown, vizAv.a?.shown, satBefore, vizBefore, vizOpacity, baseStyle, showCoastlines, showBorders, showRivers, numeric, suppressLines, shading]);

  const driver = viz?.time_enabled ? viz : sat?.time_enabled ? sat : undefined;
  const driverAv = viz?.time_enabled ? vizAv : satAv;
  return { specs, sat, viz, satAv, vizAv, satBefore, vizBefore, driver, driverAv };
}
