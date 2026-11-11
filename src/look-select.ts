import { CircleGeometry, DoubleSide, Mesh, MeshBasicMaterial, Object3D, RingGeometry, type Vector3 } from '@iwsdk/core';

const SEGMENTS = 48;

/**
 * "Look to select", the visible half: a small cursor where the head points, and a ring
 * that fills clockwise around the target while the user holds still.
 */
export class LookSelectVisual {
  readonly root = new Object3D();
  private readonly track: Mesh;
  private readonly fill: Mesh;
  private readonly cursor: Mesh;
  private readonly fillGeometry: RingGeometry;
  private readonly materials: MeshBasicMaterial[];

  constructor() {
    this.root.name = 'look-select';
    const track = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false, side: DoubleSide });
    const fill = new MeshBasicMaterial({ color: 0x2fb5a8, transparent: true, opacity: 0.95, depthTest: false, side: DoubleSide });
    const dot = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    this.materials = [track, fill, dot];
    this.track = new Mesh(new RingGeometry(0.017, 0.022, SEGMENTS), track);
    this.fillGeometry = new RingGeometry(0.017, 0.022, SEGMENTS, 1, Math.PI / 2, -Math.PI * 2); // starts at 12 o'clock, clockwise
    this.fill = new Mesh(this.fillGeometry, fill);
    this.cursor = new Mesh(new CircleGeometry(0.004, 16), dot);
    for (const mesh of [this.track, this.fill, this.cursor]) {
      mesh.renderOrder = 10;
      this.root.add(mesh);
    }
    this.root.visible = false;
  }

  /** Bolder colours for the High contrast option. */
  setContrast(on: boolean): void {
    this.materials[0].opacity = on ? 0.7 : 0.35;
    this.materials[1].color.set(on ? 0xffd400 : 0x2fb5a8);
  }

  /** Shows the cursor (and the fill around a target) at `at`, facing `viewer`. */
  show(at: Vector3, viewer: Vector3, progress: number, onTarget: boolean): void {
    this.root.visible = true;
    this.root.position.copy(at);
    this.root.lookAt(viewer);
    this.track.visible = onTarget;
    this.fill.visible = onTarget && progress > 0;
    // Index count grows with progress: the ring fills clockwise from the top.
    const triangles = Math.round(SEGMENTS * Math.min(1, progress)) * 2;
    this.fillGeometry.setDrawRange(0, triangles * 3);
  }

  hide(): void {
    this.root.visible = false;
  }
}
