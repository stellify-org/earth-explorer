import { CameraEventType, KeyboardEventModifier, type CesiumWidget } from "@cesium/engine";
import { BoundingSphere, Cartesian2, Cartesian3, Cartographic, HeadingPitchRange, Math as CMath, Matrix4 } from "@cesium/core";

export const MAX_WHEEL = 240;

const PINCH_GAIN = 10;

export function wheelPixels(deltaY: number, deltaMode: number, pinch: boolean): number {
  if (!Number.isFinite(deltaY)) return 0;
  let px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 120 : deltaY;
  if (pinch) px *= PINCH_GAIN;
  return Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, px));
}

export function liftedHeight(height: number, ground: number, clearance: number): number | undefined {
  return height < ground + clearance / 2 ? ground + clearance : undefined;
}

export type Ground = (lonDeg: number, latDeg: number) => number | undefined;
const grounds = new WeakMap<CesiumWidget, Set<Ground>>();

export function addGround(viewer: CesiumWidget, ground: Ground): () => void {
  let set = grounds.get(viewer);
  if (!set) grounds.set(viewer, (set = new Set()));
  set.add(ground);
  return () => { set.delete(ground); };
}

const GLOBE_GUARD_BELOW = 12_000;

export function installCameraControls(viewer: CesiumWidget): () => void {
  const scene = viewer.scene, ctl = scene.screenSpaceCameraController, canvas = scene.canvas, box = viewer.container as HTMLElement;

  ctl.minimumZoomDistance = 50;
  ctl.maximumZoomDistance = 32_000_000;
  ctl.enableLook = false;
  ctl.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH];
  ctl.tiltEventTypes = [
    CameraEventType.MIDDLE_DRAG, CameraEventType.RIGHT_DRAG, CameraEventType.PINCH,
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
    { eventType: CameraEventType.RIGHT_DRAG, modifier: KeyboardEventModifier.CTRL },
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT },
    { eventType: CameraEventType.RIGHT_DRAG, modifier: KeyboardEventModifier.SHIFT },
  ];

  let sum = 0, frame = 0;
  const onWheel = (e: WheelEvent) => {
    if (!e.isTrusted || e.target !== canvas) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = e.shiftKey && e.deltaY === 0 ? e.deltaX : e.deltaY;
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; sum = 0; });
    sum = Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, sum + wheelPixels(raw, e.deltaMode, e.ctrlKey || e.metaKey)));
    if (sum === 0) return;
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: sum, deltaMode: 0, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
  };
  box.addEventListener("wheel", onWheel, { capture: true, passive: false });

  const noMenu = (e: Event) => { if (e.target === canvas) e.preventDefault(); };
  box.addEventListener("contextmenu", noMenu);

  const carto = new Cartographic();
  const unGuard = scene.preRender.addEventListener(() => {
    const cam = viewer.camera;
    if (!ctl.enableCollisionDetection || !Matrix4.equals(cam.transform, Matrix4.IDENTITY)) return;
    if (!Cartographic.fromCartesian(cam.positionWC, undefined, carto)) return;
    let ground: number | undefined;
    if (carto.height < GLOBE_GUARD_BELOW) ground = scene.globe.getHeight(carto) ?? 0;
    const extra = grounds.get(viewer);
    if (extra?.size) {
      const lon = CMath.toDegrees(carto.longitude), lat = CMath.toDegrees(carto.latitude);
      for (const g of extra) { const h = g(lon, lat); if (h !== undefined && (ground === undefined || h > ground)) ground = h; }
    }
    if (ground === undefined) return;
    const h = liftedHeight(carto.height, ground, ctl.minimumZoomDistance);
    if (h === undefined) return;
    carto.height = h;
    Cartographic.toCartesian(carto, undefined, cam.position);
  });

  const level = () => {
    const cam = viewer.camera;
    if (viewer.isDestroyed() || !ctl.enableCollisionDetection || !Matrix4.equals(cam.transform, Matrix4.IDENTITY)) return;
    const roll = Math.abs(CMath.negativePiToPi(cam.roll));
    if (roll < CMath.toRadians(0.2) || Math.abs(cam.pitch) > CMath.toRadians(85)) return;
    cam.setView({ orientation: { heading: cam.heading, pitch: cam.pitch, roll: 0 } });
  };
  const unLevel = viewer.camera.moveEnd.addEventListener(level);

  return () => {
    unLevel();
    cancelAnimationFrame(frame);
    box.removeEventListener("wheel", onWheel, { capture: true });
    box.removeEventListener("contextmenu", noMenu);
    unGuard();
    cancelMove(viewer);
  };
}

function viewCentre(viewer: CesiumWidget): { point: Cartesian3; range: number } | undefined {
  const { scene, camera } = viewer;
  const ray = camera.getPickRay(new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2));
  const point = ray && scene.globe.pick(ray, scene);
  return point ? { point, range: Cartesian3.distance(camera.positionWC, point) } : undefined;
}

const moves = new WeakMap<CesiumWidget, number>();
function cancelMove(viewer: CesiumWidget) { cancelAnimationFrame(moves.get(viewer) ?? 0); moves.delete(viewer); }

export function zoomStep(viewer: CesiumWidget, direction: "in" | "out", ms = 280) {
  const { scene, camera } = viewer, ctl = scene.screenSpaceCameraController;
  const height = camera.positionCartographic.height, range = viewCentre(viewer)?.range ?? height;
  const total = direction === "in"
    ? Math.min(range / 2, range - ctl.minimumZoomDistance)
    : -Math.min(range, ctl.maximumZoomDistance - height);
  if (!(Math.abs(total) > 1) || (direction === "in" && total < 0)) return;
  cancelMove(viewer);
  camera.cancelFlight();
  const t0 = performance.now();
  let done = 0;
  const tick = (now: number) => {
    if (viewer.isDestroyed()) return;
    const f = Math.min(1, (now - t0) / ms), eased = 1 - (1 - f) * (1 - f);
    camera.moveForward(total * eased - done);
    done = total * eased;
    scene.requestRender();
    if (f < 1) moves.set(viewer, requestAnimationFrame(tick)); else moves.delete(viewer);
  };
  moves.set(viewer, requestAnimationFrame(tick));
}

function orbit(viewer: CesiumWidget, heading: number, pitch: number) {
  const { camera } = viewer, c = viewCentre(viewer);
  cancelMove(viewer);
  if (!c) { camera.flyTo({ destination: camera.positionWC.clone(), orientation: { heading, pitch, roll: 0 }, duration: 0.6 }); return; }
  camera.flyToBoundingSphere(new BoundingSphere(c.point, 0), { offset: new HeadingPitchRange(heading, pitch, Math.max(c.range, 1)), duration: 0.6 });
}

export function northUp(viewer: CesiumWidget) {
  orbit(viewer, 0, Math.min(viewer.camera.pitch, CMath.toRadians(-10)));
}

export const isTopDown = (pitch: number) => pitch < CMath.toRadians(-80);

export const TILT_BELOW = 2_000_000;

export function toggleTilt(viewer: CesiumWidget) {
  const { camera } = viewer;
  orbit(viewer, camera.heading, isTopDown(camera.pitch) ? CMath.toRadians(-45) : -CMath.PI_OVER_TWO);
}
