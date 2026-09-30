import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';

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

function sideColor(minutes: number): number {
  if (minutes <= 30) return 0x7cc6f2;
  if (minutes <= 60) return 0x39b8a8;
  if (minutes <= 120) return 0xf2b544;
  return 0xef7a5a;
}

function drawLabel(title: string, minutes: number, color: number, priority: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 224;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7f9fc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, canvas.width, 16);
  ctx.fillStyle = '#1f2328';
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  let text = title;
  while (ctx.measureText(text).width > canvas.width - 32 && text.length > 4) {
    text = `${text.slice(0, -2)}.`;
  }
  ctx.fillText(text, 16, 48);
  ctx.fillStyle = '#5b616b';
  ctx.font = '500 52px system-ui, sans-serif';
  ctx.fillText(formatMinutes(minutes), 16, 128);
  if (priority === 1) {
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

/** Builds one tile mesh. Materials are per-tile so overflow tinting stays local. */
export function createTileMesh(title: string, minutes: number, priority = 2): Mesh {
  const color = sideColor(minutes);
  const side = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5 });
  const label = drawLabel(title, minutes, color, priority);
  const top = new MeshStandardMaterial({
    map: label,
    emissiveMap: label,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
    roughness: 0.7,
  });
  // BoxGeometry groups: +x, -x, +y (top), -y, +z, -z.
  const geometry = new BoxGeometry(TILE_WIDTH, tileThickness(minutes), TILE_DEPTH);
  const mesh = new Mesh(geometry, [side, side, top, side, side, side]);
  mesh.name = `tile-${title}`;
  mesh.userData.baseColor = color;
  return mesh;
}

export function setTileOverflow(mesh: Mesh, overflow: boolean): void {
  const [side, , top] = mesh.material as MeshStandardMaterial[];
  if (overflow) {
    side.emissive.copy(OVERFLOW);
    side.emissiveIntensity = 0.9;
    top.emissive.copy(OVERFLOW);
    top.emissiveIntensity = 0.55;
  } else {
    side.emissive.setHex(mesh.userData.baseColor as number);
    side.emissiveIntensity = 0.25;
    top.emissive.setHex(0xffffff);
    top.emissiveIntensity = 0.35;
  }
}

/** Frees the per-tile materials and label texture. */
export function disposeTileMaterials(mesh: Mesh): void {
  for (const material of mesh.material as MeshStandardMaterial[]) {
    material.map?.dispose();
    material.dispose();
  }
}
