import { Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { roundedSlab } from './shapes.js';

/** Tray-local layout shared with the runtime systems (metres, +Z toward the user). */
export const TRAY = {
  width: 0.6,
  depth: 0.36,
  baseHeight: 0.006,
  surfaceY: 0.008,
  inbox: { x: 0, z: -0.115, width: 0.56, depth: 0.11 },
  zones: {
    Now: { x: -0.19, z: 0.07 },
    Later: { x: 0, z: 0.07 },
    Drop: { x: 0.19, z: 0.07 },
  },
  zoneSize: 0.16,
} as const;

const frosted = new MeshStandardMaterial({
  color: 0xe8eef5,
  emissive: 0x9fb4d6,
  emissiveIntensity: 0.18,
  roughness: 0.85,
  transparent: true,
  opacity: 0.55,
});
const lipMaterial = new MeshStandardMaterial({
  color: 0xf4f7fb,
  emissive: 0xbfd3f2,
  emissiveIntensity: 0.35,
  roughness: 0.6,
  transparent: true,
  opacity: 0.8,
});
const inboxMaterial = new MeshStandardMaterial({
  color: 0xcfd6df,
  emissive: 0x7d8796,
  emissiveIntensity: 0.12,
  roughness: 0.9,
  transparent: true,
  opacity: 0.6,
});
const zoneMaterials = {
  Now: new MeshStandardMaterial({ color: 0x2fb5a8, emissive: 0x2fb5a8, emissiveIntensity: 0.45, roughness: 0.7, transparent: true, opacity: 0.75 }),
  Later: new MeshStandardMaterial({ color: 0x8c7ae6, emissive: 0x8c7ae6, emissiveIntensity: 0.4, roughness: 0.7, transparent: true, opacity: 0.7 }),
  Drop: new MeshStandardMaterial({ color: 0xb49aa3, emissive: 0x8a7078, emissiveIntensity: 0.3, roughness: 0.8, transparent: true, opacity: 0.6 }),
};

function build(): Group {
  const tray = new Group();
  tray.name = 'DayTray';

  const base = new Mesh(roundedSlab(TRAY.width, TRAY.depth, TRAY.baseHeight, 0.03), frosted);
  base.name = 'tray-base';
  tray.add(base);

  const lip = new Mesh(
    roundedSlab(TRAY.width, TRAY.depth, 0.012, 0.03, { width: TRAY.width - 0.016, depth: TRAY.depth - 0.016, radius: 0.024 }),
    lipMaterial,
  );
  lip.name = 'tray-lip';
  tray.add(lip);

  const inbox = new Mesh(roundedSlab(TRAY.inbox.width, TRAY.inbox.depth, 0.002, 0.012), inboxMaterial);
  inbox.name = 'zone-inbox';
  inbox.position.set(TRAY.inbox.x, TRAY.baseHeight, TRAY.inbox.z);
  tray.add(inbox);

  const padGeometry = roundedSlab(TRAY.zoneSize, TRAY.zoneSize, 0.002, 0.014);
  for (const [zone, at] of Object.entries(TRAY.zones)) {
    const pad = new Mesh(padGeometry, zoneMaterials[zone as keyof typeof zoneMaterials]);
    pad.name = `zone-${zone.toLowerCase()}`;
    pad.position.set(at.x, TRAY.baseHeight, at.z);
    tray.add(pad);
  }
  return tray;
}

export const dayTray = build();
