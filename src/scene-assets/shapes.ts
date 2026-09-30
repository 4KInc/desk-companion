import { ExtrudeGeometry, Path, Shape, type BufferGeometry } from '@iwsdk/core';

/** Rounded-rectangle outline in the XY plane, centred on the origin. */
export function roundedRectShape(width: number, depth: number, radius: number): Shape {
  const w = width / 2;
  const d = depth / 2;
  const r = Math.min(radius, w, d);
  const shape = new Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);
  return shape;
}

function roundedRectPath(width: number, depth: number, radius: number): Path {
  const path = new Path();
  path.setFromPoints(roundedRectShape(width, depth, radius).getPoints(6));
  return path;
}

/**
 * A flat rounded slab lying on the XZ plane: bottom face at y = 0, top at
 * y = height. An optional inner cut-out turns it into a rounded frame (lip).
 */
export function roundedSlab(
  width: number,
  depth: number,
  height: number,
  radius: number,
  hole?: { width: number; depth: number; radius: number },
): BufferGeometry {
  const shape = roundedRectShape(width, depth, radius);
  if (hole) shape.holes.push(roundedRectPath(hole.width, hole.depth, hole.radius));
  const bevel = Math.min(0.0015, height / 3);
  const geometry = new ExtrudeGeometry(shape, {
    depth: height - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  // Extrusion runs along +Z; lay it flat so thickness runs along +Y and the
  // shape's +Y maps to -Z (back of the tray).
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  geometry.computeVertexNormals();
  return geometry;
}
