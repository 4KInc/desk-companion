import {
  BoxGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from '@iwsdk/core';

/** Layout shared with the runtime animation (metres; origin at desk contact, +Z faces the user). */
export const BUDDY = {
  height: 0.086,
  /** Front/back squash that turns the lathe into a bean. */
  depthScale: 0.88,
  eyeY: 0.058,
  handY: 0.03,
  handX: 0.031,
  notebookZ: 0.05,
} as const;

const bodyMaterial = new MeshStandardMaterial({ color: 0xf4f7fb, emissive: 0xdfe8f2, emissiveIntensity: 0.22, roughness: 0.55 });
const accentMaterial = new MeshStandardMaterial({ color: 0x2fb5a8, emissive: 0x2fb5a8, emissiveIntensity: 0.35, roughness: 0.5 });
const eyeMaterial = new MeshStandardMaterial({ color: 0x1f2328, roughness: 0.3 });
const pageMaterial = new MeshStandardMaterial({ color: 0xfbfcfe, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.8 });

/**
 * Lathe profile [radius, y]: a flat seat, a softly rounded base, the widest belly,
 * then an elliptical dome to the top, so the head reads round rather than pointed.
 */
const PROFILE: [number, number][] = (() => {
  const points: [number, number][] = [[0, 0], [0.025, 0], [0.03, 0.004], [0.033, 0.014], [0.034, 0.03]];
  const domeBase = 0.03;
  const domeRadius = 0.034;
  const domeHeight = BUDDY.height - domeBase;
  for (let i = 1; i <= 10; i++) {
    const t = (i / 10) * (Math.PI / 2);
    points.push([domeRadius * Math.cos(t), domeBase + domeHeight * Math.sin(t)]);
  }
  points[points.length - 1] = [0, BUDDY.height];
  return points;
})();

/** Body radius at height y, matching the lathe profile (used to seat parts on the surface). */

function radiusAt(y: number): number {
  for (let i = 1; i < PROFILE.length; i++) {
    const [r0, y0] = PROFILE[i - 1];
    const [r1, y1] = PROFILE[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

function build(): Group {
  const root = new Group();
  root.name = 'buddy-root';

  const body = new Mesh(
    new LatheGeometry(PROFILE.map(([r, y]) => new Vector2(r, y)), 28),
    bodyMaterial,
  );
  body.name = 'buddy-body';
  body.scale.z = BUDDY.depthScale;
  root.add(body);

  // Teal headband hugging the body at its own radius, so it sits on the surface.
  const bandY = 0.066;
  const band = new Mesh(new TorusGeometry(radiusAt(bandY), 0.0032, 8, 32), accentMaterial);
  band.name = 'buddy-band';
  band.rotation.x = Math.PI / 2;
  band.position.y = bandY;
  band.scale.y = BUDDY.depthScale; // torus local y becomes world z after the rotation
  root.add(band);

  // Eyes: shallow ovals embedded in the front surface (front = +Z, squashed by depthScale).
  const face = new Group();
  face.name = 'buddy-face';
  const eyeGeometry = new SphereGeometry(1, 12, 8);
  for (const side of [-1, 1] as const) {
    const eye = new Mesh(eyeGeometry, eyeMaterial);
    eye.name = side < 0 ? 'eye-left' : 'eye-right';
    const x = side * 0.0105;
    const surfaceZ = Math.sqrt(Math.max(0, radiusAt(BUDDY.eyeY) ** 2 - x * x)) * BUDDY.depthScale;
    eye.scale.set(0.0042, 0.0062, 0.0018);
    eye.position.set(x, BUDDY.eyeY, surfaceZ - 0.0006);
    face.add(eye);
  }
  root.add(face);

  // Hands: small nubs sunk a little into the sides so they read as attached.
  const handGeometry = new SphereGeometry(0.0078, 12, 8);
  for (const side of [-1, 1] as const) {
    const hand = new Mesh(handGeometry, bodyMaterial);
    hand.name = side < 0 ? 'hand-left' : 'hand-right';
    hand.position.set(side * BUDDY.handX, BUDDY.handY, 0.008);
    root.add(hand);
  }

  // A tiny open notebook on the desk in front, within the hands' reach.
  const notebook = new Group();
  notebook.name = 'buddy-notebook';
  const cover = new Mesh(new BoxGeometry(0.05, 0.002, 0.032), accentMaterial);
  cover.name = 'notebook-cover';
  cover.position.y = 0.001;
  notebook.add(cover);
  for (const side of [-1, 1] as const) {
    const page = new Mesh(new BoxGeometry(0.0225, 0.0015, 0.028), pageMaterial);
    page.name = side < 0 ? 'page-left' : 'page-right';
    page.position.set(side * 0.0122, 0.0027, 0);
    page.rotation.z = side * -0.06; // pages rise gently toward the spine
    notebook.add(page);
  }
  notebook.position.z = BUDDY.notebookZ;
  root.add(notebook);
  return root;
}

export const deskBuddy = build();
