import {
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector2,
} from '@iwsdk/core';

export const JAR = {
  radius: 0.05,
  height: 0.13,
  wall: 0.003,
  floor: 0.006,
  fillRadius: 0.043,
  /** Maximum fill height (metres) the runtime may scale jar-fill to. */
  maxFill: 0.115,
} as const;

const glass = new MeshStandardMaterial({
  color: 0xdcecf7,
  emissive: 0x9cc3de,
  emissiveIntensity: 0.15,
  roughness: 0.15,
  metalness: 0,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
});
const rimMaterial = new MeshStandardMaterial({ color: 0xeef6fb, emissive: 0xbad7ea, emissiveIntensity: 0.3, roughness: 0.3, transparent: true, opacity: 0.6 });
const fillMaterial = new MeshStandardMaterial({ color: 0xf5b945, emissive: 0xf0a020, emissiveIntensity: 0.55, roughness: 0.5 });

function build(): Group {
  const jar = new Group();
  jar.name = 'DoneJar';
  const { radius: r, height: h, wall: t, floor: f } = JAR;

  // Closed wall profile (outside up, over the lip, inside down, across the floor).
  const profile = [
    new Vector2(0, 0),
    new Vector2(r - 0.006, 0),
    new Vector2(r, 0.006),
    new Vector2(r, h),
    new Vector2(r - t, h),
    new Vector2(r - t, f + 0.004),
    new Vector2(r - t - 0.004, f),
    new Vector2(0, f),
  ];
  const body = new Mesh(new LatheGeometry(profile, 24), glass);
  body.name = 'jar-glass';
  jar.add(body);

  const rim = new Mesh(new TorusGeometry(r - t / 2, 0.003, 6, 24), rimMaterial);
  rim.name = 'jar-rim';
  rim.rotation.x = Math.PI / 2;
  rim.position.y = h;
  jar.add(rim);

  // Unit-height cylinder anchored at its bottom; the app scales y to the fill level.
  const fillGeometry = new CylinderGeometry(JAR.fillRadius, JAR.fillRadius, 1, 20);
  fillGeometry.translate(0, 0.5, 0);
  const fill = new Mesh(fillGeometry, fillMaterial);
  fill.name = 'jar-fill';
  fill.position.y = f;
  fill.scale.y = 0.02;
  jar.add(fill);
  return jar;
}

export const doneJar = build();
