import {
  Credit, UrlTemplateImageryProvider, WebMercatorTilingScheme,
} from "@cesium/engine";
import type { Layer } from "../api/types";
import { gibsTemplate } from "./tileUrls";

export function gibsProvider(layer: Layer, date?: string): UrlTemplateImageryProvider {
  const url = gibsTemplate(layer, date);
  return new UrlTemplateImageryProvider({
    url,
    tilingScheme: new WebMercatorTilingScheme(),
    maximumLevel: layer.max_level,
    credit: new Credit("NASA GIBS", false),
  });
}
