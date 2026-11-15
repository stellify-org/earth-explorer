import { create } from "zustand";
import type { SceneOptions } from "./scene";

export interface ScenarioLocation {
  id: string;

  name: string;
  country: string;
  region: string;
  lat: number; lon: number;

  bbox: [number, number, number, number];
  theme: string;

  question: string;

  experiment: string;

  data: string;

  kind: "reservoir" | "lake" | "history";
  model: string;
  interactions: string[];

  pack: string[];
  scene: Pick<SceneOptions, "exaggeration" | "view">;

  raiseMaxM?: number;
  features: { balance: boolean; buildings: boolean; landCover: boolean };

  how: string[];

  story?: { title: string; paragraphs: string[] };
}

export const LOCATIONS: ScenarioLocation[] = [
  {
    id: "nurek", name: "Nurek Reservoir", country: "Tajikistan", region: "Vakhsh River, Khatlon", lat: 38.37, lon: 69.45, bbox: [69.245, 69.725, 38.245, 38.605],
    theme: "Reservoir levels and flooded land",
    question: "What happens when the water in a mountain reservoir rises?",
    experiment: "Raise or lower the water; change inflow, outflow, rain and evaporation",
    data: "Elevation, published storage law, evaporation table, rain climatology, land cover, buildings",
    kind: "reservoir", model: "Published level–storage law + flood fill on the elevation grid + daily water balance",
    interactions: ["water level", "water balance", "before / after", "land cover", "buildings"],
    pack: ["nurek.json", "nurek.bin", "nurek_landcover.bin", "nurek_buildings.json", "nurek_buildings.bin", "nurek_buildings_ids.bin"],
    scene: { exaggeration: 2 }, features: { balance: true, buildings: true, landCover: true },
    how: [
      "The ground is a real elevation model measured from space in February 2000. The lake is where that model recorded flat water.",
      "When you raise the level, water spreads only to places it can actually reach from the lake. The dam stops it.",
      "How much water a level change means comes from a formula published by engineers who studied the dam's records.",
    ],
  },
  {
    id: "kayrakkum", name: "Bahri Tojik", country: "Tajikistan", region: "Syr Darya, Sughd Province", lat: 40.3, lon: 70.1, bbox: [69.72, 70.62, 40.13, 40.52],
    theme: "Drought, water management and land exposure",
    question: "What happens when less water enters a reservoir?",
    experiment: "Change the river inflow and the release through the dam; watch the level and the shore",
    data: "Elevation, lake outline, published levels and 2009 storage figure, rain climatology. No storage curve, no evaporation data",
    kind: "reservoir", model: "Straight line between two published levels (approximate) + flood fill on the elevation grid + daily water balance",
    interactions: ["water level", "water balance", "before / after"],
    pack: ["kayrakkum.json", "kayrakkum.bin", "kayrakkum_mask.bin"],
    scene: { exaggeration: 8, view: { col: 0.42, row: 0.5, heading: 0, pitch: -42, range: 105_000, radius: 30_000 } },
    features: { balance: true, buildings: false, landCover: false },
    how: [
      "The ground is a real elevation model measured from space in February 2000, when the lake stood at 345 m.",
      "Less water coming in than going out makes the lake fall; more makes it rise. The model adds up the water day by day and loses none.",
      "Nobody has published how much water this lake holds at each level, so the storage change here is a rough straight-line estimate between two published levels.",
      "Above 345 m the shore comes from the elevation model. Below 345 m the lake bed was under water when the model was made, so the new shore cannot be drawn.",
    ],
  },
  {
    id: "sarez", name: "Lake Sarez", country: "Tajikistan", region: "Pamir Mountains, Gorno-Badakhshan", lat: 38.2, lon: 72.75, bbox: [72.5, 73.37, 38.05, 38.45],
    theme: "Mountain lakes, natural dams and geological history",
    question: "How can geological events reshape the landscape?",
    experiment: "Explore the lake, the natural dam and real earthquakes; raise the water a little",
    data: "Elevation, lake outline, USGS earthquakes, published history. No lake-bed map, no storage curve",
    kind: "lake", model: "Flood fill on the elevation grid for small rises only; no storage model",
    interactions: ["history", "earthquakes", "small rise of the water level", "before / after"],
    pack: ["sarez.json", "sarez.bin", "sarez_mask.bin"],
    scene: { exaggeration: 1.5, view: { col: 0.36, row: 0.5, heading: 12, pitch: -40, range: 88_000, radius: 26_000 } },
    raiseMaxM: 20, features: { balance: false, buildings: false, landCover: false },
    how: [
      "The mountains are a real elevation model measured from space in February 2000. The lake is where that model recorded flat water.",
      "The orange dots are real earthquakes from the USGS catalog, placed at their catalog positions.",
      "You can raise the water a little to see where the shore would move. Nobody has an open map of the lake bed, so lowering is not offered and no stored volume is calculated.",
    ],
    story: {
      title: "How the lake was made",
      paragraphs: [
        "On 18 February 1911 a magnitude 7.2 earthquake shook the Pamir. About 2 cubic kilometres of rock slid into the valley of the Murghab River and buried the village of Usoi.",
        "The rock pile became a natural dam about 600 metres high — taller than any dam people have built. It is called the Usoi Dam.",
        "The river filled the valley behind it. The rising water drowned the village of Sarez, which gave the lake its name. In its first years the lake rose by tens of metres a year.",
        "The lake has never flowed over the dam. Its water seeps through the rock and comes out below as springs, about 45 cubic metres every second, and becomes the river again.",
        "Scientists watch the dam and the slopes above the lake. A monitoring and early-warning system has worked there since December 2004. Studies for the United Nations judged a sudden outburst unlikely in the near future, and this scene does not try to simulate one.",
      ],
    },
  },
  {
    id: "aral", name: "Aral Sea", country: "Kazakhstan and Uzbekistan", region: "Central Asia", lat: 45.2, lon: 60.0, bbox: [57.5, 62.5, 43.0, 47.5],
    theme: "Water loss and environmental change",
    question: "How did a vast lake lose so much water?",
    experiment: "Travel through satellite maps of the water from 1987 to 2021 and compare two years",
    data: "Satellite water maps of eight years (JRC Global Surface Water, from Landsat). No depths, no levels, no forecast",
    kind: "history", model: "None: observed maps and areas added up from them",
    interactions: ["choose a year", "play the years", "compare two years"],
    pack: ["aral.json", "aral.bin"],
    scene: {}, features: { balance: false, buildings: false, landCover: false },
    how: [
      "Satellites of the Landsat programme have photographed this place since the 1980s. Scientists turned those pictures into maps that say, for every 30-metre spot and every year, whether it was water.",
      "The blue shape is where at least half of each small square was water all year. The sand colour shows where there was water in 1987 and none in the year you chose.",
      "The areas are added up from the maps. They are measurements of the past, not a model, and they say nothing about how deep the water is.",
    ],
    story: {
      title: "What happened to the sea",
      paragraphs: [
        "Two rivers, the Syr Darya and the Amu Darya, flow down from faraway mountains and used to pool in the lowest part of the basin. The lake they made was once the fourth largest in the world.",
        "In the 1960s the Soviet Union began a major water diversion project: the rivers were used to turn the desert into farms for cotton and other crops. With far less river water arriving, the sea shrank.",
        "The North (Small) Aral Sea separated from the South (Large) Aral Sea. The South Aral then split into an eastern and a western lobe.",
        "The Kok-Aral dike and dam, finished in 2005, keeps water in the North Aral, and its level rebounded. The shallow eastern lobe of the South Aral retreated fast; in 2014 it disappeared completely.",
      ],
    },
  },
];

export const useLabPlace = create<{ id?: string; set: (id?: string) => void }>((set) => ({ id: undefined, set: (id) => set({ id }) }));
export const locationById = (id?: string) => LOCATIONS.find((l) => l.id === id);
