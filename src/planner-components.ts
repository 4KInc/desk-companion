import { createComponent, Types } from '@iwsdk/core';

export const Zone = {
  Inbox: 'inbox',
  Now: 'now',
  Later: 'later',
  Drop: 'drop',
  /** Flicked away tonight; hidden until the next day's rollover returns it to the Inbox. */
  Tomorrow: 'tomorrow',
} as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

/** One task card on the desk. Thickness comes from `minutes` (1 cm per 30 min). */
export const TaskTile = createComponent('TaskTile', {
  taskId: { type: Types.Int32, default: 0 },
  minutes: { type: Types.Int16, default: 30, min: 5, max: 480 },
  /** 1 = high, 2 = normal, 3 = low. The capacity nudge moves low priority first. */
  priority: { type: Types.Int8, default: 2, min: 1, max: 3 },
  zone: { type: Types.Enum, enum: Zone, default: Zone.Inbox },
  /** Order within the zone; lower values sit lower in a stack. */
  order: { type: Types.Float32, default: 0 },
  /** Tray-local resting position the tile eases toward when not held. */
  target: { type: Types.Vec3, default: [0, 0, 0] },
  /** True while the tile's top is above the Now capacity line. */
  overflow: { type: Types.Boolean, default: false },
  /** Floating above the tray in focus mode with a running timer. */
  focused: { type: Types.Boolean, default: false },
  /** Total seconds spent on this task in focus mode. */
  focusSeconds: { type: Types.Float32, default: 0 },
});

export const PlacementState = {
  Authored: 'authored',
  Searching: 'searching',
  Placing: 'placing',
  Placed: 'placed',
} as const;

/** Lives on the `desk-setup` scene entity; tracks how the tray found the desk. */
export const DeskPlacement = createComponent('DeskPlacement', {
  state: { type: Types.Enum, enum: PlacementState, default: PlacementState.Authored },
  /** 'anchor' when last session's anchor was restored, 'table' for a labelled table plane, 'surface' for tap-to-place. */
  source: { type: Types.String, default: '' },
  /** Set by the Move tray button: place by hand only, never snap back to a detected table. */
  manual: { type: Types.Boolean, default: false },
  /**
   * Radians the panel and buddy were swung around the seated user because the tray sits more
   * than 25 degrees off head-forward (0 when centred). The planner swings the focus spot too.
   */
  swing: { type: Types.Float32, default: 0 },
});
