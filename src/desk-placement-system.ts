import {
  createSystem,
  EnvironmentRaycastTarget,
  Mesh,
  MeshBasicMaterial,
  RaycastSpace,
  RingGeometry,
  Vector3,
  VisibilityState,
  XRPlane,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { DeskPlacement, PlacementState } from './planner-components.js';

/** How long to wait for a labelled table before offering tap-to-place. */
const TABLE_SEARCH_SECONDS = 2.5;
/** Tray centre sits this far in front of the head, measured horizontally. */
const TRAY_REACH = 0.45;
/** Ignore tables further than this from the seated user. */
const MAX_TABLE_DISTANCE = 1.6;

/**
 * Moves the authored `desk-setup` group onto the real desk when an XR session
 * starts: a Space Setup plane labelled "table" if one is near, otherwise a
 * right-hand ray reticle the user pinches to place.
 */
export class DeskPlacementSystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private desk?: Entity;
  private deskObject?: Object3D;
  private reticle?: Entity;
  private searchTimer = 0;
  private session?: XRSession;
  /** Ignore the pinch that pressed "Move tray" itself. */
  private placingSince = 0;
  private readonly authoredPosition = new Vector3();
  private readonly authoredYaw = { value: 0 };
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly point = new Vector3();
  private readonly planePosition = new Vector3();
  private readonly onSelect = () => this.confirmReticle();

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        if (visibility === VisibilityState.NonImmersive) this.endSession();
        else if (!this.session) this.beginSession();
      }),
      () => this.endSession(),
    );
  }

  private bindDesk(): boolean {
    if (this.desk) return true;
    const desk = this.world.getSceneEntity('desk-setup');
    const object = desk?.object3D;
    if (!desk || !object) return false;
    this.desk = desk;
    this.deskObject = object;
    this.authoredPosition.copy(object.position);
    this.authoredYaw.value = object.rotation.y;
    desk.addComponent(DeskPlacement, { state: PlacementState.Authored });
    return true;
  }

  private setState(state: string, source = ''): void {
    this.desk?.setValue(DeskPlacement, 'state', state as (typeof PlacementState)[keyof typeof PlacementState]);
    this.desk?.setValue(DeskPlacement, 'source', source);
  }

  private beginSession(): void {
    if (!this.bindDesk()) return;
    this.session = this.world.renderer.xr.getSession() ?? undefined;
    this.session?.addEventListener('select', this.onSelect);
    this.searchTimer = TABLE_SEARCH_SECONDS;
    this.setState(PlacementState.Searching);
  }

  private endSession(): void {
    this.session?.removeEventListener('select', this.onSelect);
    this.session = undefined;
    this.hideReticle();
    if (this.deskObject) {
      this.deskObject.position.copy(this.authoredPosition);
      this.deskObject.rotation.set(0, this.authoredYaw.value, 0);
      this.setState(PlacementState.Authored);
    }
  }

  update(delta: number): void {
    if (!this.bindDesk()) return;
    if (!this.session && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      this.beginSession();
    }
    const state = this.desk!.getValue(DeskPlacement, 'state');
    if (state !== PlacementState.Searching && state !== PlacementState.Placing) return;
    if (state === PlacementState.Placing && !this.reticle) {
      this.showReticle(); // entered Placing from the Move tray button
      this.placingSince = performance.now();
    }

    this.player.head.getWorldPosition(this.head);
    const manual = this.desk!.getValue(DeskPlacement, 'manual') === true;
    const tableY = manual ? undefined : this.findTableHeight();
    if (tableY !== undefined) {
      this.player.head.getWorldDirection(this.forward);
      // Object3D.getWorldDirection returns +Z; the camera looks down -Z.
      this.forward.set(-this.forward.x, 0, -this.forward.z);
      if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
      this.forward.normalize();
      this.point.copy(this.head).addScaledVector(this.forward, TRAY_REACH);
      this.point.y = tableY;
      this.placeAt(this.point, 'table');
      return;
    }
    if (state === PlacementState.Searching) {
      this.searchTimer -= delta;
      if (this.searchTimer <= 0) {
        this.showReticle();
        this.placingSince = performance.now();
        this.setState(PlacementState.Placing);
      }
    }
  }

  /** Height of the nearest horizontal plane labelled "table" in front of the user. */
  private findTableHeight(): number | undefined {
    let best: number | undefined;
    let bestDistance = MAX_TABLE_DISTANCE;
    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const object = entity.object3D;
      if (!plane || !object) continue;
      if (plane.orientation !== 'horizontal' || plane.semanticLabel !== 'table') continue;
      object.getWorldPosition(this.planePosition);
      const drop = this.head.y - this.planePosition.y;
      if (drop < 0.15 || drop > 1.3) continue;
      const distance = Math.hypot(this.planePosition.x - this.head.x, this.planePosition.z - this.head.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = this.planePosition.y;
      }
    }
    return best;
  }

  private placeAt(worldPoint: Vector3, source: string): void {
    const object = this.deskObject!;
    const yaw = Math.atan2(this.head.x - worldPoint.x, this.head.z - worldPoint.z);
    this.point.copy(worldPoint);
    object.parent?.worldToLocal(this.point);
    object.position.copy(this.point);
    object.rotation.set(0, yaw, 0);
    this.hideReticle();
    this.setState(PlacementState.Placed, source);
    this.desk!.setValue(DeskPlacement, 'manual', false);
  }

  private showReticle(): void {
    if (this.reticle) return;
    const ring = new Mesh(
      new RingGeometry(0.03, 0.042, 32),
      new MeshBasicMaterial({ color: 0x5fe0d0, transparent: true, opacity: 0.9, depthTest: false }),
    );
    ring.name = 'placement-reticle';
    this.reticle = this.world.createTransformEntity(ring);
    this.reticle.addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Right });
  }

  private hideReticle(): void {
    this.reticle?.dispose();
    this.reticle = undefined;
  }

  private confirmReticle(): void {
    const reticle = this.reticle;
    if (!reticle || this.desk?.getValue(DeskPlacement, 'state') !== PlacementState.Placing) return;
    if (performance.now() - this.placingSince < 400) return;
    if (!reticle.getValue(EnvironmentRaycastTarget, 'xrHitTestResult') || !reticle.object3D) return;
    this.player.head.getWorldPosition(this.head);
    reticle.object3D.getWorldPosition(this.point);
    this.placeAt(this.point.clone(), 'surface');
  }
}
