import {
  CanvasTexture,
  ExtrudeGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { roundedRectShape } from './scene-assets/shapes.js';

export const TILE_WIDTH = 0.1;
export const TILE_DEPTH = 0.07;
/** 1 cm of thickness per 30 minutes of estimated work. */
export const METRES_PER_MINUTE = 0.01 / 30;

export function tileThickness(minutes: number): number {
  return Math.max(0.005, minutes * METRES_PER_MINUTE);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const OVERFLOW = new Color(0xff3b30);

/** Accessibility options that change how tiles are built. */
export interface TileStyle {
  /** 30% bigger footprint: easier to see and to pinch. */
  large: boolean;
  /** Saturated colours, heavier type and stronger glow. */
  contrast: boolean;
}

export const LARGE_TILE_SCALE = 1.3;

function sideColor(minutes: number, contrast: boolean): number {
  if (contrast) {
    if (minutes <= 30) return 0x0a84ff;
    if (minutes <= 60) return 0x00a37a;
    if (minutes <= 120) return 0xff9f0a;
    return 0xff453a;
  }
  if (minutes <= 30) return 0x7cc6f2;
  if (minutes <= 60) return 0x39b8a8;
  if (minutes <= 120) return 0xf2b544;
  return 0xef7a5a;
}

function drawLabel(
  title: string,
  minutes: number,
  color: number,
  priority: number,
  contrast: boolean,
  meetingTime?: string,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 224;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7f9fc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, canvas.width, 16);
  ctx.fillStyle = contrast ? '#000000' : '#1f2328';
  ctx.font = contrast ? '800 48px system-ui, sans-serif' : '600 44px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  let text = title;
  while (ctx.measureText(text).width > canvas.width - 32 && text.length > 4) {
    text = `${text.slice(0, -2)}.`;
  }
  ctx.fillText(text, 16, 48);
  ctx.fillStyle = contrast ? '#000000' : '#5b616b';
  ctx.font = contrast ? '800 56px system-ui, sans-serif' : '500 52px system-ui, sans-serif';
  ctx.fillText(meetingTime ?? formatMinutes(minutes), 16, 128);
  if (meetingTime) {
    // A small calendar mark: meetings come from the calendar and cannot be moved.
    const x = canvas.width - 72;
    ctx.fillStyle = contrast ? '#000000' : '#5b6576';
    ctx.fillRect(x, 132, 52, 44);
    ctx.fillStyle = '#f7f9fc';
    ctx.fillRect(x + 5, 146, 42, 25);
    ctx.fillStyle = contrast ? '#000000' : '#5b6576';
    ctx.fillRect(x + 10, 124, 6, 14);
    ctx.fillRect(x + 36, 124, 6, 14);
  } else if (priority === 1) {
    // High priority: a bold badge in the corner, readable at arm's length.
    ctx.fillStyle = '#e8643c';
    ctx.beginPath();
    ctx.arc(canvas.width - 44, 160, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', canvas.width - 44, 139);
    ctx.textAlign = 'left';
  } else if (priority === 3) {
    ctx.fillStyle = '#8a9099';
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('low', canvas.width - 16, 142);
    ctx.textAlign = 'left';
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A rounded tile: an extruded rounded rectangle, centred on its origin like a box.
 * Two draw groups (sides + labelled top), as before: ExtrudeGeometry puts the caps
 * in group 0 and the sides in group 1, so the indices are swapped to match the
 * [side, top] material order, and the cap UVs are remapped so the label spans the
 * top face and reads from the user's side (+Z).
 */
function tileGeometry(width: number, thickness: number, depth: number): ExtrudeGeometry {
  const bevel = Math.min(0.0015, thickness / 3);
  const shape = roundedRectShape(width - 2 * bevel, depth - 2 * bevel, Math.min(0.012, width * 0.12));
  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel - thickness / 2, 0);
  for (const group of geometry.groups) group.materialIndex = group.materialIndex === 0 ? 1 : 0;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (const group of geometry.groups) {
    if (group.materialIndex !== 1) continue; // only the caps carry the label
    for (let i = group.start; i < group.start + group.count; i++) {
      uv.setXY(i, (position.getX(i) + width / 2) / width, (depth / 2 - position.getZ(i)) / depth);
    }
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Builds one tile mesh. Materials are per-tile so overflow tinting stays local. */
export function createTileMesh(
  title: string,
  minutes: number,
  priority = 2,
  style: TileStyle = { large: false, contrast: false },
  meetingTime?: string,
): Mesh {
  // Meetings are slate grey whatever their length: fixed weight, not your own work.
  const color = meetingTime ? (style.contrast ? 0x3c4454 : 0x6b7486) : sideColor(minutes, style.contrast);
  const side = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5 });
  const label = drawLabel(title, minutes, color, priority, style.contrast, meetingTime);
  const top = new MeshStandardMaterial({
    map: label,
    emissiveMap: label,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    roughness: 0.7,
  });
  const scale = style.large ? LARGE_TILE_SCALE : 1;
  const mesh = new Mesh(tileGeometry(TILE_WIDTH * scale, tileThickness(minutes), TILE_DEPTH * scale), [side, top]);
  mesh.name = `tile-${title}`;
  mesh.userData.baseColor = color;
  mesh.userData.contrast = style.contrast;
  applyTileGlow(mesh);
  return mesh;
}

export function setTileOverflow(mesh: Mesh, overflow: boolean): void {
  mesh.userData.overflow = overflow;
  applyTileGlow(mesh);
}

/** Highlights the tile a hand is about to grab. */
export function setTileHover(mesh: Mesh, hover: boolean): void {
  mesh.userData.hover = hover;
  applyTileGlow(mesh);
}

/** One place combines overflow (red) and hover (brighter) so neither undoes the other. */
function applyTileGlow(mesh: Mesh): void {
  const [side, top] = mesh.material as MeshStandardMaterial[];
  const overflow = mesh.userData.overflow === true;
  const hover = mesh.userData.hover === true;
  if (overflow) {
    side.emissive.copy(OVERFLOW);
    top.emissive.copy(OVERFLOW);
  } else {
    side.emissive.setHex(mesh.userData.baseColor as number);
    top.emissive.setHex(0xffffff);
  }
  const boost = mesh.userData.contrast === true ? 0.2 : 0;
  side.emissiveIntensity = (overflow ? 0.9 : 0.25) + (hover ? 0.5 : 0) + boost;
  top.emissiveIntensity = (overflow ? 0.55 : 0.35) + (hover ? 0.3 : 0) + boost;
}

/** Frees the per-tile materials and label texture. */
export function disposeTileMaterials(mesh: Mesh): void {
  for (const material of mesh.material as MeshStandardMaterial[]) {
    material.map?.dispose();
    material.dispose();
  }
}

/** Fades a tile back while another one is in focus. Event-driven, not per frame. */
export function setTileDim(mesh: Mesh, dim: boolean): void {
  for (const material of new Set(mesh.material as MeshStandardMaterial[])) {
    if (material.transparent === dim) continue;
    material.transparent = dim;
    material.opacity = dim ? 0.3 : 1;
    material.depthWrite = !dim;
    material.needsUpdate = true;
  }
}

const TIMER_W = 256;
const TIMER_H = 96;

/** A flat mm:ss label that sits just beyond a focused tile's far edge. */
export function createTimerLabel(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = TIMER_W;
  canvas.height = TIMER_H;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(0.09, 0.034),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.name = 'focus-timer';
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData.canvas = canvas;
  setTimerText(mesh, 0);
  return mesh;
}

export function setTimerText(mesh: Mesh, seconds: number): void {
  const canvas = mesh.userData.canvas as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  ctx.clearRect(0, 0, TIMER_W, TIMER_H);
  ctx.fillStyle = '#1f6f68';
  ctx.beginPath();
  ctx.roundRect(4, 4, TIMER_W - 8, TIMER_H - 8, 40);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 60px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${m}:${String(s).padStart(2, '0')}`, TIMER_W / 2, TIMER_H / 2 + 3);
  ((mesh.material as MeshBasicMaterial).map as CanvasTexture).needsUpdate = true;
}
