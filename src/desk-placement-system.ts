import {
  createSystem,
  Quaternion,
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
import { plausibleDeskPose } from './anchor-store.js';
import { DeskAnchor } from './desk-anchor.js';
import { offAxis, rotateAbout, swingFor } from './fov-swing.js';
import { DeskPlacement, PlacementState } from './planner-components.js';

/** How long to wait for a labelled table before offering tap-to-place. */
const TABLE_SEARCH_SECONDS = 2.5;
/** Tray centre sits this far in front of the head, measured horizontally. */
const TRAY_REACH = 0.45;
/** Ignore tables further than this from the seated user. */
const MAX_TABLE_DISTANCE = 1.6;
/** After a restored anchor resolves, how long it may take to be located before we move on. */
const ANCHOR_LOCATE_SECONDS = 2;
/** Scene nodes that swing toward the user when the tray sits off to one side. */
const SWING_NODES = ['planner-panel', 'desk-buddy'];

/**
 * Moves the authored `desk-setup` group onto the real desk when an XR session
 * starts: last session's persistent anchor if the headset still knows it, else a
 * Space Setup plane labelled "table" if one is near, otherwise a right-hand ray
 * reticle the user pinches to place. Every placement is anchored for next time.
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
  private readonly deskAnchor = new DeskAnchor();
  /** A restore request is in flight; table detection waits for it (it times out by itself). */
  private restorePending = false;
  /** Seconds left for a restored anchor to be located. */
  private anchorLocateTimer = 0;
  /** A fresh placement waiting for the next XR frame to be anchored. */
  private pendingAnchor?: { position: { x: number; y: number; z: number }; yaw: number };
  private readonly anchorPosition = new Vector3();
  /** The tray's yaw, chosen to face the seated user at placement (anchors keep only the position). */
  private facingYaw = 0;
  /** The panel and buddy as authored in the scene (desk-local), to swing toward the user. */
  private swingTargets: { object: Object3D; position: Vector3; quaternion: Quaternion }[] = [];
  private readonly swingQuat = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

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
    for (const name of SWING_NODES) {
      const target = this.world.getSceneObject(name);
      if (target) this.swingTargets.push({ object: target, position: target.position.clone(), quaternion: target.quaternion.clone() });
    }
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
    const session = this.session;
    if (session && DeskAnchor.canPersist(session)) {
      this.restorePending = true;
      void this.deskAnchor.restore(session).then((anchor) => {
        if (this.session !== session) return;
        this.restorePending = false;
        this.anchorLocateTimer = anchor ? ANCHOR_LOCATE_SECONDS : 0;
      });
    }
  }

  private endSession(): void {
    this.session?.removeEventListener('select', this.onSelect);
    this.session = undefined;
    this.deskAnchor.endSession();
    this.restorePending = false;
    this.anchorLocateTimer = 0;
    this.pendingAnchor = undefined;
    this.hideReticle();
    if (this.deskObject) {
      this.deskObject.position.copy(this.authoredPosition);
      this.deskObject.rotation.set(0, this.authoredYaw.value, 0);
      this.applySwing(0);
      this.setState(PlacementState.Authored);
    }
  }

  update(delta: number): void {
    if (!this.bindDesk()) return;
    if (!this.session && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      this.beginSession();
    }
    const state = this.desk!.getValue(DeskPlacement, 'state');
    this.trackAnchor(state ?? "");
    if (state !== PlacementState.Searching && state !== PlacementState.Placing) return;
    if (state === PlacementState.Placing && !this.reticle) {
      this.showReticle(); // entered Placing from the Move tray button
      this.placingSince = performance.now();
    }

    this.player.head.getWorldPosition(this.head);
    if (state === PlacementState.Searching && this.tryRestoredAnchor(delta)) return;
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

  /**
   * Last session's anchor, if the headset restored and located it: place the tray there.
   * Returns true while still waiting for it (so table detection holds off) or once placed.
   */
  private tryRestoredAnchor(delta: number): boolean {
    if (this.restorePending) return true;
    const anchor = this.deskAnchor.anchor;
    if (!anchor || this.anchorLocateTimer <= 0) return false;
    const pose = this.anchorPose(anchor);
    if (!pose) {
      this.anchorLocateTimer -= delta;
      return this.anchorLocateTimer > 0;
    }
    this.anchorLocateTimer = 0;
    if (!plausibleDeskPose(this.anchorPosition, this.head)) {
      // A different room, or a bad relocalisation: forget it and find the desk afresh.
      if (this.session) void this.deskAnchor.forget(this.session);
      return false;
    }
    // Keep where the tray was, but turn it to face how the user sits today.
    this.facingYaw = Math.atan2(this.head.x - this.anchorPosition.x, this.head.z - this.anchorPosition.z);
    this.applyPose(this.anchorPosition, this.facingYaw);
    this.hideReticle();
    this.setState(PlacementState.Placed, 'anchor');
    this.swingTowardUser();
    return true;
  }

  /** Keeps the tray locked to its anchor while placed; on tracking loss it simply stays put. */
  private trackAnchor(state: string): void {
    const session = this.session;
    const frame = this.world.renderer.xr.getFrame();
    const space = this.world.renderer.xr.getReferenceSpace();
    if (this.pendingAnchor && session && frame && space) {
      const { position, yaw } = this.pendingAnchor;
      this.pendingAnchor = undefined;
      void this.deskAnchor.create(session, frame, space, position, yaw);
    }
    const anchor = this.deskAnchor.anchor;
    if (state !== PlacementState.Placed || !anchor) return;
    if (this.anchorPose(anchor)) this.applyPose(this.anchorPosition, this.facingYaw);
  }

  /** Anchor pose in reference space (= world here: the player rig never moves) into anchorPosition. */
  private anchorPose(anchor: XRAnchor): { yaw: number } | undefined {
    const frame = this.world.renderer.xr.getFrame();
    const space = this.world.renderer.xr.getReferenceSpace();
    if (!frame || !space) return undefined;
    let pose: XRPose | undefined;
    try {
      pose = frame.getPose(anchor.anchorSpace, space) ?? undefined;
    } catch {
      return undefined; // the anchor was deleted or belongs to an ended session
    }
    if (!pose) return undefined;
    const { position: p, orientation: q } = pose.transform;
    this.anchorPosition.set(p.x, p.y, p.z);
    return { yaw: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) };
  }

  /**
   * If the tray landed more than 25 degrees off where the user faces, keep it there but swing
   * the panel and buddy around the user (same distance, now inside the cone) and turn them to
   * face the user. Measured against the head's horizontal forward at placement.
   */
  private swingTowardUser(): void {
    const object = this.deskObject!;
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.forward);
    this.forward.set(-this.forward.x, 0, -this.forward.z); // the head looks down its -Z
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    object.updateMatrixWorld(true);
    object.getWorldPosition(this.point);
    this.applySwing(swingFor(offAxis(this.head, this.forward, this.point)));
  }

  private applySwing(swing: number): void {
    const object = this.deskObject;
    if (!object) return;
    object.updateMatrixWorld(true);
    this.swingQuat.setFromAxisAngle(this.up, swing);
    for (const target of this.swingTargets) {
      if (swing === 0) {
        target.object.position.copy(target.position);
        target.object.quaternion.copy(target.quaternion);
        continue;
      }
      this.point.copy(target.position);
      object.localToWorld(this.point);
      const turned = rotateAbout(this.point, this.head, swing);
      this.point.set(turned.x, this.point.y, turned.z);
      object.worldToLocal(this.point);
      target.object.position.copy(this.point);
      // The desk is only ever yawed, so a world yaw is the same yaw in the desk's frame.
      target.object.quaternion.copy(this.swingQuat).multiply(target.quaternion);
    }
    this.desk?.setValue(DeskPlacement, 'swing', swing);
  }

  private applyPose(worldPoint: Vector3, yaw: number): void {
    const object = this.deskObject!;
    this.point.copy(worldPoint);
    object.parent?.worldToLocal(this.point);
    object.position.copy(this.point);
    object.rotation.set(0, yaw, 0);
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
    const yaw = Math.atan2(this.head.x - worldPoint.x, this.head.z - worldPoint.z);
    this.facingYaw = yaw;
    this.applyPose(worldPoint, yaw);
    // Anchor it on the next frame (createAnchor needs one); this replaces any older anchor.
    this.pendingAnchor = { position: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z }, yaw };
    this.hideReticle();
    this.setState(PlacementState.Placed, source);
    this.desk!.setValue(DeskPlacement, 'manual', false);
    this.swingTowardUser();
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
