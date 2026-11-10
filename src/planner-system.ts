import {
  BoxGeometry,
  CanvasTexture,
  createSystem,
  CylinderGeometry,
  DepthOccludable,
  DoubleSide,
  Grabbed,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OneHandGrabbable,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  UIKit,
  UIKitMLAsset,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { draftForTask, splitBrainDump, splitTaskSteps, type DraftTask } from './brain-dump.js';
import { clockTime, fetchMeetings, sampleMeetings, type DayMeeting } from './calendar-client.js';
import { coachHint, coachStep, type CoachStep } from './coach-steps.js';
import { LOCAL_FALLBACK_LINE } from './agent-call.js';
import { nudgeDone, nudgeWhy } from './nudge-words.js';
import { returnCallback } from './return-callback.js';
import { markMoment } from './session-metrics.js';
import { clearAnchorHandle } from './anchor-store.js';
import { DwellTimer, pickTarget, type DwellCandidate } from './dwell.js';
import { rotateAbout } from './fov-swing.js';
import { LookSelectVisual } from './look-select.js';
import { EXAMPLE_DUMP } from './example-day.js';
import { matchingMeeting } from './meeting-match.js';
import { CoachVisuals } from './coach.js';
import { adjustEstimate, biasByCategory, biasLine, MIN_SAMPLES, type Category } from './estimates.js';
import { Companion } from './companion.js';
import { DeskSounds } from './sound.js';
import { speechRecognitionConstructor, type SpeechRecognitionLike } from './speech.js';
import { DeskPlacement, PlacementState, TaskTile, Zone } from './planner-components.js';
import {
  emptyState,
  endDay,
  jarLayers,
  startsNewWeek,
  loadState,
  planDay,
  plannedMinutes,
  previousDay,
  rollover,
  saveState,
  type PlannerState,
  type StoredDraft,
  type StoredTask,
} from './planner-store.js';
import { TRAY } from './scene-assets/day-tray.scene-asset.js';
import { JAR } from './scene-assets/done-jar.scene-asset.js';
import {
  createTileMesh,
  createTimerLabel,
  disposeTileMaterials,
  formatMinutes,
  METRES_PER_MINUTE,
  setTileDim,
  setTileHover,
  setTileOverflow,
  setTimerText,
  TILE_DEPTH,
  tileThickness,
} from './task-tile-visual.js';

/** Capacity line rises 2 cm per available hour (same scale as tile thickness). */
const METRES_PER_HOUR = 60 * METRES_PER_MINUTE;
const ZONE_MARGIN = 0.025;
const MAX_DROP_HEIGHT = 0.3;
const JAR_CATCH_RADIUS = 0.08;
const JAR_CATCH_HEIGHT = 0.3;
/** Inbox grid: 5 columns of normal tiles, or 4 wider columns with Larger tiles on. */
const INBOX_GRID = { normal: { columns: 5, spacing: 0.108 }, large: { columns: 4, spacing: 0.138 } };
const STACK_GAP = 0.0004;
const SAVE_DELAY = 0.6;
/** Leftward hand speed (m/s, tray-relative) that counts as a flick to tomorrow. */
const FLICK_SPEED = 0.9;
/** How long a flick's peak speed is remembered, so a release just after the swing still counts. */
const FLICK_MEMORY = 0.35;
/** A flick must also carry the tile this far to the left: a speed spike alone is tracking noise. */
const FLICK_MIN_TRAVEL = 0.12;
/** How long the Undo button stays up after a destructive action. */
const UNDO_SECONDS = 8;
/** A grabbable tile within this distance of a hand lifts and glows, so the pinch closes in free air. */
const HOVER_RADIUS = 0.1;
const HOVER_RADIUS_LARGE = 0.13;
const HOVER_LIFT = 0.015;
/** Tiles this long landing in Now get the agent's offer to split them into steps. */
const SPLIT_MIN_MINUTES = 120;
/** Body-doubling lines: the buddy settles in to work alongside you. */
const FOCUS_LINES = [
  "I'll work on my stuff too. You've got this.",
  "Let's do this together. I'll be right here.",
  'Focus time. I am working alongside you.',
];
/** Gentle check-in cadence while focusing (minutes). */
const CHECK_IN_MINUTES = 25;
/** Releasing a tile this close to the buddy hands it to the agent for a first draft. */
const BUDDY_CATCH_RADIUS = 0.12;
/** How often the next-meeting line refreshes, and how early the buddy gives a heads-up. */
const NEXT_MEETING_CHECK_SECONDS = 15;
const HEADS_UP_MINUTES = 5;
const MAX_DRAFTS = 20;
/** Lines the panel's draft reader shows; the full draft is on the 2D page. */
const DRAFT_LINES = 8;

/** Splits a draft into display lines: real line breaks, or inline "1. ... 2. ..." / " - " items. */
function draftLines(body: string): string[] {
  let lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 2) {
    lines = body
      .split(/\s+(?=\d+[.)]\s)|\s+-\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return lines.map((line) => (line.length > 110 ? `${line.slice(0, 107)}...` : line));
}
const DRAFT_KIND_LABEL: Record<string, string> = {
  email: 'Email draft',
  message: 'Message draft',
  outline: 'Outline',
  checklist: 'Checklist',
  notes: 'Notes',
};
/** A panel button as Look to select sees it (UIKit components are Object3Ds with signals). */
type LookButton = Object3D & { isVisible?: { peek(): boolean } };
/** Hold still this long to press with Look to select. */
const DWELL_SECONDS = 1.0;
/** Angular half-size of targets for Look to select (degrees at the seated distance). */
const LOOK_RADIUS = { button: 2.6, tileHalfWidth: 0.04, zoneHalfWidth: 0.08 } as const;
const MAX_LOOK_CANDIDATES = 64;
/** The first-ever overflow: the red line flares this long. */
const OVERFLOW_FLASH_SECONDS = 1.6;
/** Draft sheets rest this far above whatever they lie on (tray-local metres). */
const SHEET_LIFT = 0.0015;
const SHEET_HOME = { x: -0.36, z: -0.03 } as const;
/** Where Move sheet (the button fallback) puts it: beside the tray, then back home. */
const SHEET_SPOTS = [SHEET_HOME, { x: -0.4, z: 0.12 }, { x: 0.4, z: 0.1 }] as const;
const SHEET_HINT_SECONDS = 20;
const SHEET_HINT = 'Pinch the draft sheet to pick it up, then set it down anywhere. Or pinch Move sheet';
const LOOK_ZONE_IDS = { now: 'zone:now', later: 'zone:later', drop: 'zone:drop', inbox: 'zone:inbox' } as const;

const OPTION_NAMES = {
  largeTiles: 'Larger tiles',
  highContrast: 'High contrast',
  reduceMotion: 'Reduce motion',
  sound: 'Sound',
  lookToSelect: 'Look to select',
} as const;
/** After a tile is set down, the panel offers Focus / Tomorrow / Split buttons for it this long. */
const TILE_ACTIONS_SECONDS = 10;
const DAY_CHECK_SECONDS = 30;
/** Releasing a tile this close to your head (horizontally) and below it counts as pulling it to your chest. */
const CHEST_RADIUS = 0.32;
const CHEST_BELOW_HEAD = { min: 0.05, max: 0.6 };
/** Tray-local spot where a focused tile floats, tilted toward the user. */
const FOCUS_SPOT = { x: 0, y: 0.2, z: 0.1 };
const FOCUS_TILT = 0.9;
/**
 * Focus time only counts as the actual when it is plausible: at least this share of
 * the estimate and at least MIN_TRACKED_MINUTES. A quick focus-then-jar (the task was
 * mostly done before focusing) would otherwise teach the model that tasks are tiny.
 */
const MIN_TRACKED_SHARE = 0.25;
const MIN_TRACKED_MINUTES = 2;
const TOOK_FACTORS = { less: 0.7, same: 1, more: 1.5 } as const;
const MAX_COMPLETIONS = 300;
/** Done-jar strata: one layer per past week (oldest at the bottom), the current week glowing on top. */
const STRATA_POOL = 8;
const STRATA_COLORS = [0x7cc6f2, 0x8c7ae6, 0x39b8a8, 0xef7a5a, 0x5f8fd1, 0xc59bd6];
const EARLIER_COLOR = 0x9aa3ad;
const CURRENT_COLOR = 0xf5b945;
const MIN_LAYER_HEIGHT = 0.0025;
/** How long the coach dwells on the capacity line, and on "You're set". */
const COACH_LINE_SECONDS = 6;
const COACH_COMPLETE_SECONDS = 5;
const STACK_ZONES = [Zone.Now, Zone.Later, Zone.Drop] as const;
const ZONE_CENTRE: Record<(typeof STACK_ZONES)[number], { x: number; z: number }> = {
  [Zone.Now]: TRAY.zones.Now,
  [Zone.Later]: TRAY.zones.Later,
  [Zone.Drop]: TRAY.zones.Drop,
};
const PLACEMENT_STATUS: Record<string, string> = {
  [PlacementState.Searching]: 'Looking for your desk...',
  [PlacementState.Placing]: 'Point at your desk and pinch to place the tray',
};

type TextElement = UIKit.Text;

/**
 * Desk Companion core loop: tiles with physical thickness, three zones on the
 * day tray, a capacity line over Now, and a done jar that never resets.
 */
export class PlannerSystem extends createSystem({
  tiles: { required: [TaskTile] },
  resting: { required: [TaskTile], excluded: [Grabbed] },
  held: { required: [TaskTile, Grabbed] },
  desk: { required: [DeskPlacement] },
}) {
  private state: PlannerState = emptyState();
  private bound = false;
  private loaded = false;
  private tray!: Object3D;
  private jar!: Object3D;
  private jarFill!: Object3D;
  private capacityLine!: Mesh;
  private capacityMaterial!: MeshBasicMaterial;
  private readonly tilesById = new Map<number, Entity>();
  private capacityText?: TextElement;
  private statusText?: TextElement;
  private jarText?: TextElement;
  private placementState = '';
  private nudgeCard?: UIKit.Container;
  private nudgeText?: TextElement;
  private nudgeTaskIds: number[] = [];
  private nudgeKey = '';
  private dismissedNudge = '';
  private splitting = false;
  private coach?: CoachVisuals;
  private readonly strata: Mesh[] = [];
  private companion?: Companion;
  private buddyNode?: Object3D;
  private draftCard?: UIKit.Container;
  private draftTitle?: TextElement;
  private draftLines: TextElement[] = [];
  private draftNext?: TextElement;
  private draftOpen = false;
  private drafting = false;
  private draftSheet?: Mesh;
  private draftListener?: (drafts: StoredDraft[]) => void;
  private calendarListener?: () => void;
  private readonly panelActions: { lookId: string; element: LookButton; run: () => void }[] = [];
  private lookCount = 0;
  /** 'tile:<id>' strings, built once per tile instead of every frame. */
  private readonly tileLookIds = new Map<number, string>();
  private lookVisual?: LookSelectVisual;
  private readonly dwell = new DwellTimer(DWELL_SECONDS);
  private readonly lookSlots: Array<DwellCandidate & { position: Vector3 }> = Array.from({ length: MAX_LOOK_CANDIDATES }, () => ({
    id: '',
    position: new Vector3(),
    radiusDeg: 0,
  }));
  /** A tile chosen by looking at it, waiting for the user to look at a zone. */
  private lookPicked?: StoredTask;
  /** A tile just moved by looking: ignored until the gaze leaves it, so it is not picked straight back up. */
  private lookSuppressed?: string;
  private readonly lookSuppressAt = new Vector3();
  private readonly lookOrigin = new Vector3();
  private readonly lookForward = new Vector3();
  private readonly lookCursor = new Vector3();
  private readonly focusLocal = new Vector3();
  private overflowFlash = 0;
  private draftSheetEntity?: Entity;
  private sheetHeld = false;
  private sheetSpot = 0;
  /** The one-time "you can move the sheet" hint is showing for this many more seconds. */
  private sheetHintTimer = 0;
  /** Where the draft sheet lies, tray-local: it stays wherever it was last put down. */
  private readonly sheetLocal = new Vector3(SHEET_HOME.x, SHEET_LIFT, SHEET_HOME.z);
  private readonly sheetFlat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  private buddyReady = false;
  private statusBeforeCatch = '';
  private lastStatus = '';
  private readonly buddyWorld = new Vector3();
  private focusSessionMs = 0;
  private coachCard?: UIKit.Container;
  private coachExample?: UIKit.Container;
  private nextText?: TextElement;
  private nextShown = '';
  private nextCheck = 0;
  /** Meetings already announced, by title and start, so a calendar re-sync does not repeat them. */
  private readonly headsUp = new Set<string>();
  private coachText?: TextElement;
  private coachNow: CoachStep = 'off';
  private coachTimer = 0;
  private canDictate = false;
  private capacityTop = 0;
  private resetting = false;
  private undoButton?: UIKit.Component;
  private undo?: {
    kind: 'defer' | 'jar' | 'drop';
    task: StoredTask;
    zone: Zone;
    order: number;
    completionsBefore: number;
  };
  private undoTimer = 0;
  private splitCard?: UIKit.Container;
  private splitText?: TextElement;
  private splitOffer?: StoredTask;
  private splitBusy = false;
  private nudgeVisible = false;
  private optionsCard?: UIKit.Container;
  private optionsOpen = false;
  private dayControls: UIKit.Component[] = [];
  private readonly optionLabels: Record<string, TextElement | undefined> = {};
  private tileActions?: UIKit.Container;
  private tileActionsText?: TextElement;
  private actionSplit?: UIKit.Component;
  private touched?: StoredTask;
  private touchedTimer = 0;
  private hovered?: Entity;
  private readonly hoverPos = new Vector3();
  private readonly gripLeft = new Vector3();
  private readonly gripRight = new Vector3();
  private recapCard?: UIKit.Container;
  private recapText?: TextElement;
  private dayCheck = DAY_CHECK_SECONDS;
  private recapOpen = false;
  private tookCard?: UIKit.Container;
  private tookText?: TextElement;
  private pendingTook?: { title: string; minutes: number; category: Category };
  private focusTask?: StoredTask;
  private focusTimer?: Mesh;
  private focusTick = 0;
  private focusSaveTick = 0;
  private readonly head = new Vector3();
  private readonly sounds = new DeskSounds();
  private readonly soundAt = new Vector3();
  private wasOverflowing = false;
  private readonly focusTilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), FOCUS_TILT);
  private readonly trayRight = new Vector3();
  private saveCountdown = 0;
  private readonly world3 = new Vector3();
  private readonly local3 = new Vector3();
  private readonly jarWorld = new Vector3();
  private readonly trayQuat = new Quaternion();
  private readonly wobble = new Quaternion();
  private readonly wobbleAxis = new Vector3(0, 0, 1);
  private readonly targetQuat = new Quaternion();

  init(): void {
    this.cleanupFuncs.push(
      () => this.sounds.dispose(),
      this.queries.held.subscribe('qualify', (entity) => {
        this.setOccludable(entity, true);
        const data = entity.object3D?.userData;
        if (data) {
          data.flick = 0;
          data.tracked = false;
        }
        this.setStatus('Drop it on Now, Later or Drop, the jar when done, or flick it left for tomorrow');
      }),
      this.queries.held.subscribe('disqualify', (entity) => {
        if (entity.object3D) this.onRelease(entity);
        // A tile kept in focus stays occludable; anything resting on the desk does not.
        if (entity.object3D && entity.getValue(TaskTile, 'taskId') !== this.state.focusTaskId) {
          this.setOccludable(entity, false);
        }
      }),
    );
    void loadState().then((saved) => {
      this.state = saved;
      this.loaded = true;
      if (this.bound) this.spawnSavedTiles();
    });
  }

  /** Scene objects load with the level, which can finish after init(). */
  private tryBind(): boolean {
    const tray = this.world.getSceneObject('day-tray');
    const jar = this.world.getSceneObject('done-jar');
    const panel = this.world.getSceneObject<UIKitMLAsset>('planner-panel');
    const fill = jar?.getObjectByName('jar-fill');
    if (!tray || !jar || !panel || !fill || !panel.getElementById('capacity-text')) return false;
    this.tray = tray;
    this.jar = jar;
    this.jarFill = fill;
    this.buildTrayDecorations();
    this.coach = new CoachVisuals(tray, jar);
    const buddy = this.world.getSceneObject('desk-buddy');
    if (buddy) {
      this.companion = new Companion(buddy);
      this.buddyNode = buddy;
    }
    this.buildJarStrata();
    this.bindPanel(panel);
    this.bound = true;
    if (this.loaded) this.spawnSavedTiles();
    return true;
  }

  private buildTrayDecorations(): void {
    // Translucent "day height" plane hovering over the Now zone.
    this.capacityMaterial = new MeshBasicMaterial({
      color: 0x5fe0d0,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    });
    const size = TRAY.zoneSize + 0.02;
    this.capacityLine = new Mesh(new BoxGeometry(size, 0.0015, size), this.capacityMaterial);
    this.capacityLine.name = 'capacity-line';
    this.capacityLine.position.set(TRAY.zones.Now.x, 0, TRAY.zones.Now.z);
    this.tray.add(this.capacityLine);

    const labels: [string, number, number][] = [
      ['NOW', TRAY.zones.Now.x, 0x1f6f68],
      ['LATER', TRAY.zones.Later.x, 0x5a48b8],
      ['DROP', TRAY.zones.Drop.x, 0x7a5a64],
    ];
    for (const [text, x, color] of labels) {
      const label = this.makeFlatLabel(text, color, 0.12, 0.022);
      label.position.set(x, TRAY.surfaceY + 0.0006, TRAY.zones.Now.z + TRAY.zoneSize / 2 + 0.014);
      this.tray.add(label);
    }
    const inbox = this.makeFlatLabel('INBOX', 0x5b616b, 0.1, 0.018);
    inbox.position.set(-TRAY.width / 2 + 0.075, TRAY.surfaceY + 0.0006, TRAY.inbox.z + TRAY.inbox.depth / 2 + 0.011);
    this.tray.add(inbox);
  }

  private buildJarStrata(): void {
    // Shared unit-height cylinder anchored at its base; each layer scales it in y.
    const geometry = new CylinderGeometry(JAR.fillRadius, JAR.fillRadius, 1, 20);
    geometry.translate(0, 0.5, 0);
    for (let i = 0; i < STRATA_POOL; i++) {
      const layer = new Mesh(geometry, new MeshStandardMaterial({ roughness: 0.55, emissiveIntensity: 0.35 }));
      layer.name = `jar-layer-${i}`;
      layer.visible = false;
      this.jar.add(layer);
      this.strata.push(layer);
    }
    this.jarFill.visible = false; // the single fill is replaced by weekly layers
  }

  private makeFlatLabel(text: string, color: number, width: number, height: number): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = Math.round((256 * height) / width);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font = `700 ${Math.round(canvas.height * 0.8)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.name = `label-${text.toLowerCase()}`;
    return mesh;
  }

  private bindPanel(panel: UIKitMLAsset): void {
    this.capacityText = panel.getElementById('capacity-text') as TextElement;
    this.coachCard = panel.getElementById('coach-card') as UIKit.Container | undefined;
    this.coachText = panel.getElementById('coach-text') as TextElement | undefined;
    this.coachExample = panel.getElementById('coach-example') as UIKit.Container | undefined;
    this.nextText = panel.getElementById('next-text') as TextElement | undefined;
    this.statusText = panel.getElementById('status-text') as TextElement;
    this.jarText = panel.getElementById('jar-text') as TextElement;
    const on = (id: string, handler: () => void) => {
      const element = panel.getElementById(id);
      if (!element) return;
      element.name = id;
      const withSound = () => {
        this.sounds.ensure();
        this.sounds.play('click');
        handler();
      };
      element.addEventListener('click', withSound);
      this.cleanupFuncs.push(() => element.removeEventListener('click', withSound));
      this.panelActions.push({ lookId: `btn:${id}`, element: element as unknown as LookButton, run: withSound });
    };
    on('hours-down', () => this.changeCapacity(-1));
    on('hours-up', () => this.changeCapacity(1));
    on('coach-example', () => void this.addBrainDump(EXAMPLE_DUMP));
    on('add-15', () => this.addTask(15));
    on('add-30', () => this.addTask(30));
    on('add-60', () => this.addTask(60));
    on('add-120', () => this.addTask(120));
    this.nudgeCard = panel.getElementById('nudge-card') as UIKit.Container | undefined;
    this.nudgeText = panel.getElementById('nudge-text') as TextElement | undefined;
    on('nudge-accept', () => this.acceptNudge());
    on('nudge-dismiss', () => this.dismissNudge());
    this.recapCard = panel.getElementById('recap-card') as UIKit.Container | undefined;
    this.recapText = panel.getElementById('recap-text') as TextElement | undefined;
    on('winddown-button', () => this.openRecap());
    on('recap-end', () => this.confirmEndDay());
    on('recap-cancel', () => this.closeRecap());
    this.tookCard = panel.getElementById('took-card') as UIKit.Container | undefined;
    this.tookText = panel.getElementById('took-text') as TextElement | undefined;
    this.undoButton = panel.getElementById('undo-button') as UIKit.Component | undefined;
    this.splitCard = panel.getElementById('split-card') as UIKit.Container | undefined;
    this.splitText = panel.getElementById('split-text') as TextElement | undefined;
    on('split-accept', () => void this.acceptSplit());
    this.optionsCard = panel.getElementById('options-card') as UIKit.Container | undefined;
    for (const id of ['opt-large-label', 'opt-contrast-label', 'opt-motion-label', 'opt-sound-label', 'opt-look-label']) {
      this.optionLabels[id] = panel.getElementById(id) as TextElement | undefined;
    }
    on('options-button', () => this.toggleOptions());
    this.dayControls = ['add-label', 'add-row', 'status-row', 'jar-text']
      .map((id) => panel.getElementById(id) as UIKit.Component | undefined)
      .filter((element): element is UIKit.Component => element !== undefined);
    on('opt-done', () => this.toggleOptions(false));
    on('opt-large', () => this.changeSetting('largeTiles'));
    on('opt-contrast', () => this.changeSetting('highContrast'));
    on('opt-motion', () => this.changeSetting('reduceMotion'));
    on('opt-sound', () => this.changeSetting('sound'));
    on('opt-look', () => this.changeSetting('lookToSelect'));
    on('draft-move', () => this.moveSheetByButton());
    this.tileActions = panel.getElementById('tile-actions') as UIKit.Container | undefined;
    this.tileActionsText = panel.getElementById('tile-actions-text') as TextElement | undefined;
    this.actionSplit = panel.getElementById('action-split') as UIKit.Component | undefined;
    on('action-focus', () => this.tileAction('focus'));
    on('action-tomorrow', () => this.tileAction('tomorrow'));
    on('action-split', () => this.tileAction('split'));
    on('action-draft', () => this.tileAction('draft'));
    this.draftCard = panel.getElementById('draft-card') as UIKit.Container | undefined;
    this.draftTitle = panel.getElementById('draft-title') as TextElement | undefined;
    this.draftLines = Array.from({ length: DRAFT_LINES }, (_, i) => panel.getElementById(`draft-line-${i}`) as TextElement | undefined)
      .filter((line): line is TextElement => line !== undefined);
    this.draftNext = panel.getElementById('draft-next') as TextElement | undefined;
    on('draft-close', () => this.closeDraft());
    on('split-dismiss', () => this.dismissSplit());
    on('undo-button', () => this.performUndo());
    on('took-less', () => this.answerTook('less'));
    on('took-same', () => this.answerTook('same'));
    on('took-more', () => this.answerTook('more'));
    this.bindDictation(panel, on);

    const xrButton = panel.getElementById('xr-button');
    const exitButton = panel.getElementById('exit-button');
    if (!xrButton || !exitButton) return;
    xrButton.name = 'xr-button';
    exitButton.name = 'exit-button';
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }
    on('xr-button', () => this.world.launchXR());
    on('exit-button', () => this.world.exitXR());
    const moveTray = panel.getElementById('move-tray-button');
    on('move-tray-button', () => this.startMoveTray());
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        const is2D = visibility === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        moveTray?.setProperties({ display: is2D ? 'none' : 'flex' });
        this.refreshCoach(); // hints differ between the browser page and the headset
      }),
    );
  }

  /** Pinch "Dictate" in XR, speak, pinch "Done": the transcript becomes a brain dump. */
  private bindDictation(panel: UIKitMLAsset, on: (id: string, handler: () => void) => void): void {
    const Recognition = speechRecognitionConstructor();
    const button = panel.getElementById('dictate-button');
    const label = panel.getElementById('dictate-label') as TextElement | undefined;
    if (!Recognition || !button) return; // no speech support: the button stays hidden
    this.canDictate = true;
    button.setProperties({ display: 'flex' });
    let recognition: SpeechRecognitionLike | undefined;
    let transcript = '';
    on('dictate-button', () => {
      if (recognition) {
        recognition.stop();
        return;
      }
      transcript = '';
      const active = new Recognition();
      recognition = active;
      active.lang = navigator.language || 'en-US';
      active.continuous = true;
      active.interimResults = true;
      active.onresult = (event) => {
        let interim = '';
        transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) transcript += `${result[0].transcript}. `;
          else interim += result[0].transcript;
        }
        this.setStatus(`Listening: ${(transcript + interim).slice(-90)}`);
      };
      active.onerror = (event) => this.setStatus(`Dictation stopped (${event.error})`);
      active.onend = () => {
        recognition = undefined;
        this.setText(label, 'Dictate');
        if (transcript.trim()) void this.addBrainDump(transcript);
      };
      active.start();
      this.setText(label, 'Done');
      this.setStatus('Listening... say what is on your mind, then pinch Done');
    });
    this.cleanupFuncs.push(() => recognition?.abort());
  }

  /** Hand the tray back to placement: aim at any surface and pinch. */
  private startMoveTray(): void {
    const desk = this.queries.desk.entities.values().next().value as Entity | undefined;
    if (!desk) return;
    desk.setValue(DeskPlacement, 'manual', true);
    desk.setValue(DeskPlacement, 'state', PlacementState.Placing);
  }

  // --- first-run coach ----------------------------------------------------

  /** Shows the hint and spatial cue for the user's current first-run step. */
  private refreshCoach(): void {
    if (!this.coach) return;
    let step = coachStep(this.state);
    if (step === 'complete' && this.coachNow !== 'complete') {
      // First task in the jar: the loop is learned. Celebrate briefly, then get out of the way.
      this.state.onboarding.done = true;
      this.coachTimer = COACH_COMPLETE_SECONDS;
      this.sounds.play('endDay');
      this.scheduleSave();
    }
    if (step === 'off' && this.coachNow === 'complete' && this.coachTimer > 0) step = 'complete';
    if (step === 'line' && this.coachNow !== 'line') this.coachTimer = COACH_LINE_SECONDS;
    this.coachNow = step;

    let ghostFrom: { x: number; y: number; z: number } | undefined;
    if (step === 'sort') {
      for (const entity of this.tilesById.values()) {
        if (entity.getValue(TaskTile, 'zone') !== Zone.Inbox || !entity.hasComponent(OneHandGrabbable)) continue;
        const target = entity.getVectorView(TaskTile, 'target');
        ghostFrom = { x: target[0], y: target[1], z: target[2] };
        break;
      }
    }
    this.coach.show(step, this.capacityTop, ghostFrom);
    if (this.sheetHintTimer > 0) {
      this.coachCard?.setProperties({ display: 'flex' });
      this.coachExample?.setProperties({ display: 'none' });
      this.setText(this.coachText, SHEET_HINT);
      return;
    }
    const inBrowser = this.world.visibilityState.peek() === VisibilityState.NonImmersive;
    const hint =
      step === 'add' && inBrowser
        ? 'Type what is on your mind in the box below, or click a time to add a task'
        : coachHint(step, this.state.capacityHours, this.canDictate);
    this.coachCard?.setProperties({ display: step === 'off' ? 'none' : 'flex' });
    // Inside the headset there is no keyboard: one pinch shows the agent at work on a real morning.
    this.coachExample?.setProperties({ display: step === 'add' ? 'flex' : 'none' });
    if (hint) this.setText(this.coachText, hint);
  }

  private tickCoach(delta: number): void {
    this.coach?.update(delta);
    if (this.sheetHintTimer > 0) {
      this.sheetHintTimer -= delta;
      if (this.sheetHintTimer <= 0) this.endSheetHint();
    }
    if (this.coachTimer <= 0) return;
    this.coachTimer -= delta;
    if (this.coachTimer > 0) return;
    if (this.coachNow === 'line') {
      this.state.onboarding.lineSeen = true;
      this.scheduleSave();
    }
    this.refreshCoach();
  }

  /** Dev-only: the worst case for profiling (25 tiles, 8 weeks of jar layers), saved, then reloaded. */
  async seedStress(): Promise<void> {
    const state = emptyState();
    state.welcomed = true;
    state.onboarding = { lineSeen: true, done: true };
    state.capacityHours = 8;
    const zones = [Zone.Inbox, Zone.Now, Zone.Later, Zone.Drop] as const;
    for (let i = 0; i < 25; i++) {
      const zone = zones[i % zones.length];
      state.tasks.push({ id: state.nextId++, title: `Stress task ${i + 1}`, minutes: 15 * (1 + (i % 6)), priority: 1 + (i % 3), zone, order: i });
    }
    const today = new Date();
    for (let week = 8; week >= 1; week--) {
      for (let d = 0; d < 3; d++) {
        const day = planDay(new Date(today.getTime() - (week * 7 - d) * 86400000));
        state.history.push({ day, plannedMinutes: 300, doneCount: 3 + (week % 3), doneMinutes: 120 });
      }
    }
    // As if last used yesterday: three tiles were pushed to tomorrow, and writing ran long.
    state.day = planDay(new Date(today.getTime() - 86400000));
    for (const task of state.tasks.slice(0, 3)) task.zone = Zone.Tomorrow;
    for (const [estimate, actual] of [[60, 85], [30, 42], [45, 63], [60, 84]]) {
      state.completions.push({ category: 'writing', estimate, actual });
    }
    state.jar.count = state.history.reduce((n, r) => n + r.doneCount, 0) + 4;
    state.jar.minutes = state.jar.count * 40;
    state.today.doneCount = 4;
    this.resetting = true;
    await saveState(state);
    location.reload();
  }

  /** Dev-only: wipe saved state and reload, for testing the first run or recording a demo. */
  async resetForDemo(): Promise<void> {
    this.resetting = true;
    try {
      clearAnchorHandle(localStorage); // a brand-new user has no desk anchor either
    } catch {
      // storage blocked: nothing to clear
    }
    await saveState(emptyState());
    location.reload();
  }

  // --- tasks -------------------------------------------------------------

  private spawnSavedTiles(): void {
    const returning = this.state.tasks.filter((task) => task.zone === Zone.Tomorrow).length;
    const dayBefore = this.state.day;
    const rolled = rollover(this.state);
    for (const task of this.state.tasks) {
      task.priority ??= 2; // tasks saved before priorities existed
      if (task.zone !== Zone.Tomorrow) this.createTile(task, false);
    }
    this.state.settings = { ...emptyState().settings, ...this.state.settings };
    this.applySettings();
    this.state.calendar = { ...emptyState().calendar, ...this.state.calendar };
    this.state.drafts ??= [];
    this.draftListener?.([...this.state.drafts]);
    if (this.state.focusTaskId && !this.tilesById.has(this.state.focusTaskId)) this.state.focusTaskId = 0;
    this.calendarListener?.();
    if (!this.state.welcomed) void this.welcome();
    else if (this.state.calendar.url || this.state.calendar.sample) void this.syncCalendar().catch(() => undefined);
    this.applyFocusVisuals();
    this.relayout();
    this.refreshJar();
    if (rolled) {
      this.scheduleSave();
      this.greetNewDay(dayBefore, returning);
      this.setStatus(
        returning > 0
          ? `Good morning. ${returning} ${returning === 1 ? 'tile' : 'tiles'} came back from yesterday`
          : 'Good morning. Brain dump your day to begin',
      );
      return;
    }
    this.setStatus(
      this.state.tasks.length === 0
        ? 'Add a task, then pinch its tile into a zone'
        : 'Pinch a tile and drop it in a zone',
    );
  }

  /** Live date change (the app was left open overnight): sync tiles with the rolled-over plan. */
  /** One concrete line from stored data when a new plan day begins (nothing said if nothing is true). */
  private greetNewDay(dayBefore: string, returning: number): void {
    if (!this.state.welcomed) return; // the first-visit welcome speaks instead
    const line = returnCallback({
      returning,
      newWeekLayer: startsNewWeek(dayBefore, this.state.day) && this.state.jar.count > 0,
      insight: biasLine(this.state.completions),
    });
    if (line) this.companion?.say(line, 10);
  }

  private applyRollover(): void {
    const dayBefore = this.state.day;
    const returning = this.state.tasks.filter((task) => task.zone === Zone.Tomorrow).length;
    if (!rollover(this.state)) return;
    this.greetNewDay(dayBefore, returning);
    const kept = new Set(this.state.tasks.map((task) => task.id));
    for (const [id, entity] of this.tilesById) {
      if (!kept.has(id) && !entity.hasComponent(Grabbed)) this.removeTile(id, entity);
    }
    for (const task of this.state.tasks) {
      if (task.zone !== Zone.Tomorrow && !this.tilesById.has(task.id)) this.createTile(task, true);
    }
    this.relayout();
    this.refreshJar();
    this.closeRecap();
    this.setStatus('A new day. Yesterday\'s tomorrow pile is back in the Inbox');
    if (this.state.calendar.url || this.state.calendar.sample) void this.syncCalendar().catch(() => undefined);
    this.scheduleSave();
  }

  private removeTile(id: number, entity: Entity): void {
    if (this.hovered === entity) this.hovered = undefined;
    this.tilesById.delete(id);
    disposeTileMaterials(entity.object3D as Mesh);
    entity.dispose();
  }

  private addTask(minutes: number): void {
    if (!this.bound) return;
    const task = this.pushTask({ title: `Task ${this.state.nextId}`, minutes, priority: 2, category: 'other' });
    this.relayout();
    this.setStatus(`Added ${task.title} (${formatMinutes(minutes)}). Pinch it into a zone`);
    this.scheduleSave();
  }

  private pushTask(draft: DraftTask): StoredTask {
    const task: StoredTask = {
      id: this.state.nextId++,
      title: draft.title,
      minutes: draft.minutes,
      priority: draft.priority,
      category: draft.category,
      zone: Zone.Inbox,
      order: this.maxOrder(Zone.Inbox) + 1,
    };
    this.state.tasks.push(task);
    this.createTile(task, true);
    return task;
  }

  /** Brain dump -> tiles. The agent splits the text; offline, a local splitter does. */
  async addBrainDump(text: string): Promise<number> {
    const trimmed = text.trim();
    if (!this.bound || this.splitting || !trimmed) return 0;
    this.splitting = true;
    this.setStatus('Sorting your brain dump into tasks...');
    // Visible within a frame: the buddy works while the agent thinks.
    this.companion?.setMode('working');
    this.companion?.say('Let me sort that into tiles...', 4);
    try {
      const split = await splitBrainDump(trimmed);
      const source = split.source;
      if (source === 'local') this.companion?.say(LOCAL_FALLBACK_LINE, 6);
      // Anything already on today's calendar is a meeting tile; don't count its time twice.
      const meetings = this.state.tasks.filter((task) => task.kind === 'meeting');
      const skipped: StoredTask[] = [];
      const tasks = split.tasks.filter((draft) => {
        const meeting = matchingMeeting(draft.title, meetings);
        if (meeting) skipped.push(meeting);
        return !meeting;
      });
      // Gently correct estimates for kinds of work this person reliably under- or over-estimates.
      const biases = biasByCategory(this.state.completions);
      let adjusted = 0;
      let total = 0;
      for (const draft of tasks) {
        const estimate = adjustEstimate(draft.minutes, draft.category, biases);
        if (estimate.adjusted) adjusted++;
        total += estimate.minutes;
        this.pushTask({ ...draft, minutes: estimate.minutes });
      }
      if (tasks.length > 0 && source === 'agent') {
        const already =
          skipped.length === 0
            ? ''
            : ` ${skipped.length === 1 ? `"${skipped[0].title}" is` : `${skipped.length} of those are`} already on your calendar.`;
        this.companion?.say(`I made ${tasks.length} tiles, ${formatMinutes(total)}.${already} Sort them into Now, Later and Drop.`);
      }
      this.soundAt.set(TRAY.inbox.x, TRAY.surfaceY, TRAY.inbox.z);
      this.tray.localToWorld(this.soundAt);
      for (let i = 0; i < tasks.length; i++) this.sounds.play('pop', this.soundAt, i * 0.08);
      this.relayout();
      this.scheduleSave();
      this.setStatus(
        tasks.length === 0
          ? skipped.length > 0
            ? 'Everything there is already on your calendar'
            : 'No tasks found in that. Try one task per line'
          : `${source === 'agent' ? 'Agent made' : 'Made (offline)'} ${tasks.length} tiles, ${formatMinutes(total)} in all.` +
              (adjusted > 0
                ? ` Adjusted ${adjusted} ${adjusted === 1 ? 'estimate' : 'estimates'} from your history.`
                : ' Sort them by hand'),
      );
      return tasks.length;
    } finally {
      this.splitting = false;
      this.companion?.setMode(this.state.focusTaskId ? 'working' : 'idle');
    }
  }

  private createTile(task: StoredTask, dropIn: boolean): void {
    if (dropIn && task.kind !== 'meeting') markMoment('firstTileAt');
    const meetingTime =
      task.kind === 'meeting' && task.startMs && task.endMs
        ? `${clockTime(task.startMs)}-${clockTime(task.endMs)}`
        : undefined;
    const mesh = createTileMesh(
      task.title,
      task.minutes,
      task.priority,
      { large: this.state.settings.largeTiles, contrast: this.state.settings.highContrast },
      meetingTime,
    );
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(TaskTile, {
      taskId: task.id,
      minutes: task.minutes,
      priority: task.priority,
      zone: task.zone,
      order: task.order,
    });
    // OneHandGrabbable is managed by relayout(): only the top of each pile can be picked up.
    this.tilesById.set(task.id, entity);
    // Start at the resting spot (after the next relayout) or slightly above it so it drops in.
    mesh.userData.spawnDrop = dropIn ? 0.12 : 0;
    mesh.userData.needsSnap = true;
  }

  private changeCapacity(delta: number): void {
    const next = Math.min(12, Math.max(1, this.state.capacityHours + delta));
    if (next === this.state.capacityHours) return;
    this.state.capacityHours = next;
    this.relayout();
    this.scheduleSave();
  }

  private maxOrder(zone: Zone): number {
    let max = 0;
    for (const task of this.state.tasks) if (task.zone === zone) max = Math.max(max, task.order);
    return max;
  }

  private taskFor(entity: Entity): StoredTask | undefined {
    const id = entity.getValue(TaskTile, 'taskId');
    return this.state.tasks.find((task) => task.id === id);
  }

  private onRelease(entity: Entity): void {
    const task = this.taskFor(entity);
    const object = entity.object3D;
    if (!task || !object || !this.bound) return;
    const flick = (object.userData.flick as number | undefined) ?? 0;
    object.getWorldPosition(this.world3);
    const travel = object.userData.tracked
      ? -(
          (this.world3.x - (object.userData.startX as number)) * this.trayRight.x +
          (this.world3.z - (object.userData.startZ as number)) * this.trayRight.z
        )
      : 0;
    object.userData.flick = 0;
    object.userData.tracked = false;
    if (flick > FLICK_SPEED && travel > FLICK_MIN_TRAVEL) {
      this.deferTask(entity, task);
      return;
    }

    this.jar.getWorldPosition(this.jarWorld);
    const dx = this.world3.x - this.jarWorld.x;
    const dz = this.world3.z - this.jarWorld.z;
    const dy = this.world3.y - this.jarWorld.y;
    if (Math.hypot(dx, dz) < JAR_CATCH_RADIUS && dy > -0.02 && dy < JAR_CATCH_HEIGHT) {
      this.completeTask(entity, task);
      return;
    }

    if (task.kind !== 'meeting' && this.isOverBuddy(this.world3)) {
      this.relayout(); // the tile floats back to its zone while the agent works
      void this.delegate(task);
      return;
    }
    if (this.isAtChest(this.world3)) {
      this.sounds.play('focusStart', this.world3);
      this.startFocus(task);
      return;
    }

    this.tray.updateWorldMatrix(true, false);
    this.local3.copy(this.world3);
    this.tray.worldToLocal(this.local3);
    const zone = this.zoneAt(this.local3);
    const wasFocused = this.state.focusTaskId === task.id;
    // Setting a focused tile back down pauses focus; its tracked time is kept.
    const paused = wasFocused && zone ? `Paused "${task.title}" at ${formatMinutes(Math.round((task.focusMs ?? 0) / 60000))}` : '';
    if (paused) {
      this.stopFocus();
      this.sounds.play('focusStop', this.world3);
    }
    if (wasFocused && !zone) {
      this.setStatus(`Still focusing on "${task.title}"`);
    } else if (zone && zone !== task.zone) {
      const where = this.assignZone(task, zone);
      this.setStatus(paused ? `${paused}, moved to ${where}` : `${task.title} moved to ${where}`);
    } else if (paused) {
      this.setStatus(paused);
    } else if (!zone) {
      this.setStatus(`${task.title} went back. Drop it over a zone`);
    }
    if (zone) this.sounds.play('snap', this.world3);
    else if (!wasFocused) this.sounds.play('miss', this.world3);
    if (task.zone !== Zone.Drop) this.showTileActions(task);
    this.relayout();
    this.scheduleSave();
  }

  /** Moves a task to a zone's top (with Undo for Drop and a split offer for big work in Now). Returns the zone's name. */
  /**
   * Where a focused tile floats, tray-local: in front of the tray, swung around the user by the
   * same angle as the panel when the tray sits off to one side, so the timer stays in view.
   */
  private focusSpot(): Vector3 {
    this.focusLocal.set(FOCUS_SPOT.x, FOCUS_SPOT.y, FOCUS_SPOT.z);
    const desk = this.queries.desk.entities.values().next().value as Entity | undefined;
    const swing = desk ? (desk.getValue(DeskPlacement, 'swing') as number) : 0;
    if (!swing) return this.focusLocal;
    this.tray.updateWorldMatrix(true, false);
    this.tray.localToWorld(this.focusLocal);
    this.player.head.getWorldPosition(this.hoverPos);
    const turned = rotateAbout(this.focusLocal, this.hoverPos, swing);
    this.focusLocal.set(turned.x, this.focusLocal.y, turned.z);
    return this.tray.worldToLocal(this.focusLocal);
  }

  private assignZone(task: StoredTask, zone: Zone): string {
    if (zone !== Zone.Inbox) markMoment('firstSortAt');
    const from = { zone: task.zone, order: task.order };
    task.zone = zone;
    task.order = this.maxOrder(zone) + 1;
    if (zone === Zone.Drop) this.offerUndo('drop', task, from.zone, from.order);
    if (zone === Zone.Now && task.kind !== 'meeting' && task.minutes >= SPLIT_MIN_MINUTES && !task.splitDeclined) {
      this.offerSplit(task);
    }
    return zone === Zone.Inbox ? 'Inbox' : zone[0].toUpperCase() + zone.slice(1);
  }

  private zoneAt(p: Vector3): Zone | undefined {
    if (p.y < -0.05 || p.y > MAX_DROP_HEIGHT) return undefined;
    const half = TRAY.zoneSize / 2 + ZONE_MARGIN;
    for (const zone of STACK_ZONES) {
      const c = ZONE_CENTRE[zone];
      if (Math.abs(p.x - c.x) < half && Math.abs(p.z - c.z) < half) return zone;
    }
    if (
      Math.abs(p.x - TRAY.inbox.x) < TRAY.inbox.width / 2 + ZONE_MARGIN &&
      Math.abs(p.z - TRAY.inbox.z) < TRAY.inbox.depth / 2 + ZONE_MARGIN
    ) {
      return Zone.Inbox;
    }
    return undefined;
  }

  private completeTask(entity: Entity, task: StoredTask): void {
    this.offerUndo('jar', task, task.zone, task.order);
    this.state.jar.count += 1;
    this.state.jar.minutes += task.minutes;
    this.state.today.doneCount += 1;
    this.state.today.doneMinutes += task.minutes;
    this.state.tasks = this.state.tasks.filter((t) => t.id !== task.id);
    this.sounds.play('jar', this.jarWorld);
    if (this.state.focusTaskId === task.id) this.stopFocus();
    this.removeTile(task.id, entity);
    const focusMinutes = (task.focusMs ?? 0) / 60000;
    if (focusMinutes >= Math.max(MIN_TRACKED_MINUTES, task.minutes * MIN_TRACKED_SHARE)) {
      const actual = Math.max(1, Math.round(focusMinutes));
      this.recordCompletion(task.category ?? 'other', task.minutes, actual);
      this.setStatus(`Done: ${task.title} in ${formatMinutes(actual)} (estimated ${formatMinutes(task.minutes)})`);
    } else {
      this.pendingTook = { title: task.title, minutes: task.minutes, category: task.category ?? 'other' };
      this.setText(
        this.tookText,
        `How long did "${task.title}" take? You estimated ${formatMinutes(task.minutes)}` +
          (focusMinutes >= 1 ? ` (focused for ${formatMinutes(Math.round(focusMinutes))}).` : '.'),
      );
      this.setStatus(`Done: ${task.title}. Into the jar`);
    }
    this.refreshCards();
    this.relayout();
    this.refreshJar();
    this.scheduleSave();
  }

  private recordCompletion(category: Category, estimate: number, actual: number): void {
    this.state.completions.push({ category, estimate, actual });
    if (this.state.completions.length > MAX_COMPLETIONS) this.state.completions.shift();
  }

  private answerTook(answer: keyof typeof TOOK_FACTORS): void {
    const pending = this.pendingTook;
    if (!pending) return;
    this.pendingTook = undefined;
    this.recordCompletion(pending.category, pending.minutes, Math.round(pending.minutes * TOOK_FACTORS[answer]));
    this.refreshCards();
    this.relayout();
    this.setStatus(answer === 'same' ? 'Noted: right on estimate' : `Noted: ${answer === 'less' ? 'quicker' : 'longer'} than estimated`);
    this.scheduleSave();
  }

  /** At most one card at a time keeps the panel short: recap, then how-long, then nudge, then split. */
  private refreshCards(): void {
    this.tookCard?.setProperties({ display: this.pendingTook && !this.recapOpen && !this.readerOpen() ? 'flex' : 'none' });
    this.refreshSplitCard();
  }

  private refreshSplitCard(): void {
    const show = this.splitOffer && !this.recapOpen && !this.pendingTook && !this.nudgeVisible && !this.readerOpen();
    this.splitCard?.setProperties({ display: show ? 'flex' : 'none' });
  }

  // --- split a big task (agent) --------------------------------------------

  private offerSplit(task: StoredTask): void {
    this.splitOffer = task;
    this.setText(this.splitText, `"${task.title}" is ${formatMinutes(task.minutes)}. Split it into smaller steps?`);
    this.refreshCards();
  }

  private dismissSplit(): void {
    if (this.splitOffer) this.splitOffer.splitDeclined = true;
    this.splitOffer = undefined;
    this.refreshCards();
    this.relayout();
    this.scheduleSave();
  }

  /** The agent restructures the plan in space: the tile cracks into its steps. */
  private async acceptSplit(): Promise<void> {
    const parent = this.splitOffer;
    if (!parent || this.splitBusy) return;
    this.splitBusy = true;
    this.setText(this.splitText, `Breaking "${parent.title}" into steps...`);
    this.companion?.setMode('working');
    try {
      const { steps, source } = await splitTaskSteps(parent.title, parent.minutes);
      if (source === 'local') this.companion?.say(LOCAL_FALLBACK_LINE, 6);
      const entity = this.tilesById.get(parent.id);
      // The tile may have been jarred, flicked or moved while the agent was thinking.
      if (!entity || !this.state.tasks.includes(parent) || entity.hasComponent(Grabbed)) return;
      const origin = new Vector3();
      entity.object3D?.getWorldPosition(origin);
      if (this.state.focusTaskId === parent.id) this.stopFocus();
      this.state.tasks = this.state.tasks.filter((task) => task !== parent);
      this.removeTile(parent.id, entity);
      this.sounds.play('crack', origin);
      steps.forEach((step, i) => {
        const task: StoredTask = {
          id: this.state.nextId++,
          title: step.title,
          minutes: step.minutes,
          priority: parent.priority,
          category: parent.category,
          zone: parent.zone,
          order: parent.order + i * 0.01,
          splitDeclined: true,
        };
        this.state.tasks.push(task);
        this.createTile(task, false);
        const mesh = this.tilesById.get(task.id)?.object3D;
        if (mesh) mesh.userData.spawnAt = origin.clone().add(new Vector3((i - (steps.length - 1) / 2) * 0.03, 0.02, 0));
        this.sounds.play('pop', origin, 0.08 + i * 0.07);
      });
      const total = steps.reduce((sum, step) => sum + step.minutes, 0);
      this.companion?.say(`Split into ${steps.length} steps. Start with the first one.`);
      this.setStatus(
        `${source === 'agent' ? 'Agent split' : 'Split (offline)'} "${parent.title}" into ${steps.length} steps, ${formatMinutes(total)}`,
      );
    } finally {
      this.splitBusy = false;
      this.companion?.setMode(this.state.focusTaskId ? 'working' : 'idle');
      this.splitOffer = undefined;
      this.refreshCards();
      this.relayout();
      this.scheduleSave();
    }
  }

  // --- focus mode ----------------------------------------------------------

  private isAtChest(world: Vector3): boolean {
    this.player.head.getWorldPosition(this.head);
    const below = this.head.y - world.y;
    return (
      Math.hypot(world.x - this.head.x, world.z - this.head.z) < CHEST_RADIUS &&
      below > CHEST_BELOW_HEAD.min &&
      below < CHEST_BELOW_HEAD.max
    );
  }

  private startFocus(task: StoredTask): void {
    if (this.state.focusTaskId && this.state.focusTaskId !== task.id) this.stopFocus();
    this.state.focusTaskId = task.id;
    this.focusSessionMs = 0;
    this.companion?.setMode('working');
    this.companion?.say(FOCUS_LINES[Math.floor(Math.random() * FOCUS_LINES.length)]);
    this.applyFocusVisuals();
    this.relayout();
    this.setStatus(`Focusing on "${task.title}". Jar it when done, or set it down to pause`);
    this.scheduleSave();
  }

  private stopFocus(): void {
    if (!this.state.focusTaskId) return;
    this.state.focusTaskId = 0;
    this.companion?.setMode('idle');
    const minutes = Math.round(this.focusSessionMs / 60000);
    if (minutes >= 1) this.companion?.say(`Nice. ${formatMinutes(minutes)} of focus together.`, 4);
    this.applyFocusVisuals();
    this.relayout();
  }

  /** Dims every other tile and moves the timer onto the focused one (or removes it). */
  private applyFocusVisuals(): void {
    const focusId = this.state.focusTaskId;
    this.focusTask = focusId ? this.state.tasks.find((task) => task.id === focusId) : undefined;
    this.companion?.setMode(focusId ? 'working' : 'idle'); // also restores the pose after a reload
    for (const [id, entity] of this.tilesById) {
      entity.setValue(TaskTile, 'focused', id === focusId);
      if (!entity.hasComponent(Grabbed)) this.setOccludable(entity, id === focusId);
      setTileDim(entity.object3D as Mesh, focusId !== 0 && id !== focusId);
    }
    const object = focusId ? this.tilesById.get(focusId)?.object3D : undefined;
    if (!object || !this.focusTask) {
      this.focusTimer?.removeFromParent();
      return;
    }
    this.focusTimer ??= createTimerLabel();
    this.focusTimer.position.set(0, tileThickness(this.focusTask.minutes) / 2 + 0.001, -(TILE_DEPTH / 2 + 0.022));
    object.add(this.focusTimer);
    setTimerText(this.focusTimer, (this.focusTask.focusMs ?? 0) / 1000);
    this.focusTick = 1;
  }

  private tickFocus(delta: number): void {
    const task = this.focusTask;
    if (!task || this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    task.focusMs = (task.focusMs ?? 0) + delta * 1000;
    const before = Math.floor(this.focusSessionMs / (CHECK_IN_MINUTES * 60000));
    this.focusSessionMs += delta * 1000;
    if (Math.floor(this.focusSessionMs / (CHECK_IN_MINUTES * 60000)) > before) {
      this.companion?.say(`${formatMinutes(Math.round(this.focusSessionMs / 60000))} in. Stretch for a minute, or keep going?`, 8);
      this.sounds.play('pop');
    }
    this.focusTick -= delta;
    if (this.focusTick > 0) return;
    this.focusTick = 1;
    const seconds = task.focusMs / 1000;
    if (this.focusTimer) setTimerText(this.focusTimer, seconds);
    this.tilesById.get(task.id)?.setValue(TaskTile, 'focusSeconds', seconds);
    if (--this.focusSaveTick <= 0) {
      this.focusSaveTick = 10;
      this.scheduleSave();
    }
  }

  /** Flicked left: the tile leaves the tray and waits in tomorrow's pile. */
  private deferTask(entity: Entity, task: StoredTask): void {
    entity.object3D?.getWorldPosition(this.soundAt);
    this.sounds.play('whoosh', this.soundAt);
    this.offerUndo('defer', task, task.zone, task.order);
    task.zone = Zone.Tomorrow;
    task.order = this.maxOrder(Zone.Tomorrow) + 1;
    this.state.today.deferredCount += 1;
    if (this.state.focusTaskId === task.id) this.stopFocus();
    this.removeTile(task.id, entity);
    this.relayout();
    this.refreshJar();
    this.setStatus(`Pushed "${task.title}" to tomorrow`);
    this.scheduleSave();
  }

  /**
   * Real hands hide a tile only while it is in the air (held or focused). Tiles resting
   * on the desk sit within depth-sensor noise of the real surface and would flicker.
   */
  private setOccludable(entity: Entity, on: boolean): void {
    const has = entity.hasComponent(DepthOccludable);
    if (on && !has) entity.addComponent(DepthOccludable, { mode: 'HardOcclusion' });
    else if (!on && has) entity.removeComponent(DepthOccludable);
  }

  // --- options (accessibility) ----------------------------------------------

  private toggleOptions(open?: boolean): void {
    this.optionsOpen = open ?? !this.optionsOpen;
    this.optionsCard?.setProperties({ display: this.optionsOpen ? 'flex' : 'none' });
    this.refreshCards();
    this.relayout();
    // While Options is open, the day controls step aside so the panel keeps its height
    // (a taller panel would sink behind the Inbox tiles).
    this.refreshDayControls();
  }

  /** True while Options or the draft reader is open: other cards wait so the panel stays short. */
  private readerOpen(): boolean {
    return this.optionsOpen || this.draftOpen;
  }

  /** Options and the draft reader need room: the day controls step aside while either is open. */
  private refreshDayControls(): void {
    const day = this.optionsOpen || this.draftOpen ? 'none' : 'flex';
    for (const element of this.dayControls) element.setProperties({ display: day });
  }

  private changeSetting(key: keyof PlannerState['settings']): void {
    const settings = this.state.settings;
    settings[key] = !settings[key];
    this.applySettings();
    if (key === 'largeTiles' || key === 'highContrast') this.rebuildTiles();
    if (key === 'reduceMotion') this.relayout();
    this.setStatus(
      key === 'lookToSelect' && settings[key]
        ? 'Look to select on: hold your gaze on a button to press it. Look at a tile, then a zone, to move it'
        : `${OPTION_NAMES[key]} ${settings[key] ? 'on' : 'off'}`,
    );
    this.scheduleSave();
  }

  /** Pushes settings into sound, the coach and the option labels. */
  private applySettings(): void {
    const { largeTiles, highContrast, reduceMotion, sound } = this.state.settings;
    this.sounds.muted = !sound;
    this.companion?.setVoice(sound);
    this.coach?.setReduceMotion(reduceMotion);
    this.companion?.setReduceMotion(reduceMotion);
    const onOff = (on: boolean) => (on ? 'On' : 'Off');
    this.setText(this.optionLabels['opt-large-label'], `Larger tiles: ${onOff(largeTiles)}`);
    this.setText(this.optionLabels['opt-contrast-label'], `High contrast: ${onOff(highContrast)}`);
    this.setText(this.optionLabels['opt-motion-label'], `Reduce motion: ${onOff(reduceMotion)}`);
    this.setText(this.optionLabels['opt-sound-label'], `Sound: ${onOff(sound)}`);
    this.setText(this.optionLabels['opt-look-label'], `Look to select: ${onOff(this.state.settings.lookToSelect)}`);
    this.lookVisual?.setContrast(highContrast);
  }

  /** Larger tiles / High contrast change how tiles are built: rebuild every tile in place. */
  private rebuildTiles(): void {
    for (const entity of this.tilesById.values()) if (entity.hasComponent(Grabbed)) return; // retry next toggle
    this.focusTimer?.removeFromParent(); // shared label: keep it out of the tiles being disposed
    for (const [id, entity] of [...this.tilesById]) this.removeTile(id, entity);
    for (const task of this.state.tasks) {
      if (task.zone === Zone.Tomorrow) continue;
      this.createTile(task, false);
    }
    this.applyFocusVisuals();
    this.relayout();
  }

  // --- hand a task to the agent ----------------------------------------------

  /** The agent writes a short first draft for a task; the buddy works on it and hands it back. */
  private async delegate(task: StoredTask): Promise<void> {
    if (this.drafting || task.kind === 'meeting') return;
    this.drafting = true;
    const short = task.title.length > 28 ? `${task.title.slice(0, 27)}.` : task.title;
    this.companion?.setMode('working');
    this.companion?.say(`On it. Drafting "${short}"...`, 5);
    this.setStatus(`The agent is drafting "${task.title}"...`);
    try {
      const { draft, source } = await draftForTask(task.title, task.minutes, task.category ?? 'other');
      const stored: StoredDraft = {
        id: this.state.nextId++,
        taskId: task.id,
        taskTitle: task.title,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        nextStep: draft.nextStep,
        day: this.state.day,
      };
      this.state.drafts.push(stored);
      if (this.state.drafts.length > MAX_DRAFTS) this.state.drafts.shift();
      task.draftId = stored.id;
      this.showDraft(stored);
      this.placeDraftSheet(stored);
      this.sounds.play('pop');
      this.companion?.say(
        source !== 'agent'
          ? LOCAL_FALLBACK_LINE
          : this.sheetHintTimer >= SHEET_HINT_SECONDS - 0.01 // the first sheet ever: teach moving it
            ? 'Draft ready. Pinch the sheet on the desk to pick it up and put it anywhere.'
            : `Draft ready: ${stored.title}. It's on the panel.`,
      );
      this.setStatus(`${source === 'agent' ? 'Agent drafted' : 'Offline head start for'} "${task.title}"`);
      this.draftListener?.([...this.state.drafts]);
      this.scheduleSave();
    } finally {
      this.drafting = false;
      this.companion?.setMode(this.state.focusTaskId ? 'working' : 'idle');
    }
  }

  private showDraft(draft: StoredDraft): void {
    // One element per line: UIKit text collapses line breaks, and checklists need their shape.
    const lines = draftLines(draft.body);
    const shown = lines.slice(0, DRAFT_LINES);
    if (lines.length > DRAFT_LINES) shown[DRAFT_LINES - 1] = '... (full draft on the page)';
    this.setText(this.draftTitle, `${DRAFT_KIND_LABEL[draft.kind] ?? 'Draft'}: ${draft.title}`);
    this.draftLines.forEach((element, i) => {
      element.setProperties({ display: i < shown.length ? 'flex' : 'none' });
      if (i < shown.length) this.setText(element, shown[i]);
    });
    this.setText(this.draftNext, `Next: ${draft.nextStep}`);
    this.draftOpen = true;
    this.draftCard?.setProperties({ display: 'flex' });
    this.refreshDayControls();
    this.refreshCards();
    this.relayout();
  }

  private closeDraft(): void {
    this.draftOpen = false;
    this.draftCard?.setProperties({ display: 'none' });
    this.refreshDayControls();
    this.refreshCards();
    this.relayout();
  }

  /** A paper sheet on the desk in front of the buddy: the agent's work, made physical. */
  private placeDraftSheet(draft: StoredDraft): void {
    if (!this.draftSheet) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 320;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      this.draftSheet = new Mesh(new PlaneGeometry(0.075, 0.094), new MeshBasicMaterial({ map: texture, side: DoubleSide }));
      this.draftSheet.name = 'draft-sheet';
      this.draftSheet.userData.canvas = canvas;
      // Its own grabbable entity: pinch it and put it anywhere (updateDraftSheet keeps it on the desk).
      this.draftSheetEntity = this.world.createTransformEntity(this.draftSheet);
      this.draftSheetEntity.addComponent(OneHandGrabbable, {});
    }
    const canvas = this.draftSheet.userData.canvas as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fbfcfe';
    ctx.fillRect(0, 0, 256, 320);
    ctx.fillStyle = '#2fb5a8';
    ctx.fillRect(0, 0, 256, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText((DRAFT_KIND_LABEL[draft.kind] ?? 'Draft').toUpperCase(), 14, 31);
    ctx.fillStyle = '#1f2328';
    ctx.font = '600 24px system-ui, sans-serif';
    draft.title.match(/.{1,18}(\s|$)/g)?.slice(0, 3).forEach((line, i) => ctx.fillText(line.trim(), 14, 84 + i * 30));
    ctx.fillStyle = '#c9d1db';
    for (let i = 0; i < 6; i++) ctx.fillRect(14, 186 + i * 20, 228 - (i % 3) * 40, 6); // text lines
    ((this.draftSheet.material as MeshBasicMaterial).map as CanvasTexture).needsUpdate = true;
    this.draftSheet.visible = true;
    this.startSheetHint();
  }

  draftsList(): StoredDraft[] {
    return [...(this.state.drafts ?? [])];
  }

  setDraftListener(listener: (drafts: StoredDraft[]) => void): void {
    this.draftListener = listener;
  }

  // --- calendar --------------------------------------------------------------

  /** Connects a private iCal link, or 'sample' for the built-in sample day. Returns a short status. */
  async connectCalendar(source: string, greeting = ''): Promise<string> {
    const sample = source === 'sample';
    const previous = this.state.calendar;
    const previousHours = this.state.capacityHours;
    this.state.calendar = { url: sample ? '' : source.trim(), sample };
    // Meetings fill a real workday: if the day length was never changed, assume 8 hours.
    if (this.state.capacityHours === emptyState().capacityHours) this.state.capacityHours = 8;
    try {
      const message = await this.syncCalendar(greeting);
      this.relayout();
      this.scheduleSave();
      return message;
    } catch (error) {
      this.state.calendar = previous;
      this.state.capacityHours = previousHours;
      throw error;
    }
  }

  /**
   * First visit: a judge or new user should see the whole idea within a minute, so the
   * buddy says hello and a sample day fills Now with meetings. Their own link replaces it.
   */
  private async welcome(): Promise<void> {
    this.state.welcomed = true;
    if (!this.state.calendar.url && !this.state.calendar.sample) {
      await this.connectCalendar('sample', "Hi, I'm your desk buddy! ").catch(() => undefined);
      // Then the one thing to do next, unless they have already started.
      setTimeout(() => {
        if (this.state.tasks.some((task) => task.kind !== 'meeting')) return;
        const inBrowser = this.world.visibilityState.peek() === VisibilityState.NonImmersive;
        this.companion?.say(
          inBrowser
            ? "What's on your mind today? Type it in the box, or tap Use an example."
            : this.canDictate
              ? "What's on your mind today? Pinch Dictate and say it, or pinch a time button."
              : "What's on your mind today? Pinch 15m, 30m, 1h or 2h to add a task.",
          9,
        );
      }, 10500);
    } else {
      this.companion?.say("Hi, I'm your desk buddy. Tell me what's on your mind and I'll make tiles.", 9);
    }
    this.calendarListener?.();
    this.scheduleSave();
  }

  setCalendarListener(listener: () => void): void {
    this.calendarListener = listener;
  }

  calendarState(): { url: string; sample: boolean } {
    return { ...this.state.calendar };
  }

  disconnectCalendar(): void {
    this.state.calendar = { url: '', sample: false };
    this.replaceMeetings([]);
    this.setStatus('Calendar disconnected');
  }

  /** Re-reads today's meetings and lays them in Now as fixed tiles. */
  async syncCalendar(greeting = ''): Promise<string> {
    const { url, sample } = this.state.calendar;
    if (!this.bound || (!url && !sample)) return 'No calendar connected';
    const meetings = sample ? sampleMeetings(this.state.day) : await fetchMeetings(url, this.state.day);
    this.replaceMeetings(meetings);
    this.nextCheck = 0; // show the next meeting right away
    const total = meetings.reduce((sum, m) => sum + Math.round((m.end - m.start) / 60000), 0);
    const free = Math.max(0, this.state.capacityHours * 60 - total);
    this.companion?.say(
      greeting +
        (meetings.length === 0
          ? 'No meetings today. The whole day is yours.'
          : sample
            ? `Sample day: ${meetings.length} meetings, ${formatMinutes(free)} left for your work.`
            : `${meetings.length} meetings today. That leaves ${formatMinutes(free)} for your own work.`),
      greeting ? 10 : 7,
    );
    const message =
      meetings.length === 0
        ? 'No meetings today. The whole day is yours'
        : `${sample ? 'Sample day: ' : ''}${meetings.length} meetings, ${formatMinutes(total)}. They sit at the bottom of Now`;
    this.setStatus(message);
    return message;
  }

  /** "Next: Design review at 11:00 (in 25m)" on the panel, and a heads-up from the buddy. */
  private refreshNextMeeting(): void {
    const now = Date.now();
    let current: StoredTask | undefined;
    let next: StoredTask | undefined;
    for (const task of this.state.tasks) {
      if (task.kind !== 'meeting' || !task.startMs || !task.endMs) continue;
      if (task.startMs <= now && task.endMs > now) current = task;
      else if (task.startMs > now && (!next || task.startMs < (next.startMs ?? 0))) next = task;
    }
    const text = current
      ? `In a meeting: ${current.title}, until ${clockTime(current.endMs!)}`
      : next
        ? `Next: ${next.title} at ${clockTime(next.startMs!)} (in ${formatMinutes(Math.ceil((next.startMs! - now) / 60000))})`
        : '';
    if (text !== this.nextShown) {
      this.nextShown = text;
      this.nextText?.setProperties({ display: text ? 'flex' : 'none' });
      if (text) this.setText(this.nextText, text);
    }
    if (!next || current) return;
    const minutes = Math.ceil((next.startMs! - now) / 60000);
    const key = `${next.title}@${next.startMs}`;
    if (minutes <= HEADS_UP_MINUTES && !this.headsUp.has(key)) {
      this.headsUp.add(key);
      this.companion?.say(`${next.title} in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. A good moment to wrap up.`, 10);
      if (this.buddyNode) this.sounds.play('focusStop', this.buddyNode.getWorldPosition(this.soundAt));
    }
  }

  private replaceMeetings(meetings: DayMeeting[]): void {
    for (const task of this.state.tasks) {
      if (task.kind !== 'meeting') continue;
      const entity = this.tilesById.get(task.id);
      if (entity) this.removeTile(task.id, entity);
    }
    this.state.tasks = this.state.tasks.filter((task) => task.kind !== 'meeting');
    for (const meeting of meetings) {
      const start = new Date(meeting.start);
      const task: StoredTask = {
        id: this.state.nextId++,
        title: meeting.title,
        minutes: Math.max(5, Math.round((meeting.end - meeting.start) / 60000)),
        priority: 1,
        zone: Zone.Now,
        order: -10000 + start.getHours() * 60 + start.getMinutes(), // bottom of Now, in time order
        kind: 'meeting',
        startMs: meeting.start,
        endMs: meeting.end,
        splitDeclined: true,
      };
      this.state.tasks.push(task);
      this.createTile(task, true);
    }
    this.relayout();
    this.scheduleSave();
  }

  // --- tile actions (gesture fallbacks) --------------------------------------

  /** Buttons for the tile just set down, so flick and chest-pull are shortcuts, not requirements. */
  private showTileActions(task: StoredTask): void {
    this.touched = task;
    this.touchedTimer = TILE_ACTIONS_SECONDS;
    const title = task.title.length > 22 ? `${task.title.slice(0, 21)}.` : task.title;
    this.setText(this.tileActionsText, `"${title}":`);
    this.actionSplit?.setProperties({
      display: task.minutes >= SPLIT_MIN_MINUTES && !task.splitDeclined ? 'flex' : 'none',
    });
    this.tileActions?.setProperties({ display: 'flex' });
  }

  private hideTileActions(): void {
    this.touched = undefined;
    this.touchedTimer = 0;
    this.tileActions?.setProperties({ display: 'none' });
  }

  private tileAction(action: 'focus' | 'tomorrow' | 'split' | 'draft'): void {
    const task = this.touched;
    this.hideTileActions();
    const entity = task ? this.tilesById.get(task.id) : undefined;
    if (!task || !entity || !this.state.tasks.includes(task) || entity.hasComponent(Grabbed)) return;
    if (action === 'focus') {
      this.sounds.play('focusStart');
      this.startFocus(task);
    } else if (action === 'tomorrow') {
      this.deferTask(entity, task);
    } else if (action === 'draft') {
      void this.delegate(task);
    } else {
      this.splitOffer = task;
      void this.acceptSplit();
    }
  }

  // --- undo -----------------------------------------------------------------

  /** Remembers the last destructive action so one pinch can reverse it for a few seconds. */
  private offerUndo(kind: 'defer' | 'jar' | 'drop', task: StoredTask, zone: Zone, order: number): void {
    this.undo = { kind, task, zone, order, completionsBefore: this.state.completions.length };
    this.undoTimer = UNDO_SECONDS;
    this.undoButton?.setProperties({ display: 'flex' });
  }

  private clearUndo(): void {
    this.undo = undefined;
    this.undoTimer = 0;
    this.undoButton?.setProperties({ display: 'none' });
  }

  private performUndo(): void {
    const undo = this.undo;
    if (!undo) return;
    this.clearUndo();
    const { task } = undo;
    if (undo.kind === 'jar') {
      // Take it back out of the jar: counts, today's totals and any learning it produced.
      this.state.jar.count = Math.max(0, this.state.jar.count - 1);
      this.state.jar.minutes = Math.max(0, this.state.jar.minutes - task.minutes);
      this.state.today.doneCount = Math.max(0, this.state.today.doneCount - 1);
      this.state.today.doneMinutes = Math.max(0, this.state.today.doneMinutes - task.minutes);
      if (this.state.completions.length > undo.completionsBefore) {
        this.state.completions.splice(undo.completionsBefore, 1);
      }
      if (this.pendingTook?.title === task.title) this.pendingTook = undefined;
      this.state.tasks.push(task);
    }
    if (undo.kind === 'defer') this.state.today.deferredCount = Math.max(0, this.state.today.deferredCount - 1);
    task.zone = undo.zone;
    task.order = undo.order - 0.5; // back to its old place in the pile
    if (!this.tilesById.has(task.id)) this.createTile(task, true);
    this.sounds.play('pop');
    this.refreshCards();
    this.relayout();
    this.refreshJar();
    this.setStatus(`Undone: "${task.title}" is back`);
    this.scheduleSave();
  }

  // --- wind-down ----------------------------------------------------------

  private openRecap(): void {
    if (!this.recapCard) return;
    const count = (zone: Zone) => this.state.tasks.filter((task) => task.zone === zone).length;
    const planned = plannedMinutes(this.state);
    const { doneCount, doneMinutes } = this.state.today;
    const tomorrow = count(Zone.Tomorrow);
    const dropping = count(Zone.Drop);
    const carrying = this.state.tasks.filter((task) => task.zone === Zone.Now && task.kind !== 'meeting').length;
    const meetingTotal = this.state.tasks
      .filter((task) => task.kind === 'meeting')
      .reduce((sum, task) => sum + task.minutes, 0);
    const lines = [
      doneCount === 0
        ? `Nothing went in the jar today${planned > 0 ? ` (you planned ${formatMinutes(planned)})` : ''}. That happens.`
        : `You planned ${formatMinutes(planned)} and finished ${formatMinutes(doneMinutes)}: ${doneCount} ${doneCount === 1 ? 'task' : 'tasks'} in the jar.`,
    ];
    if (meetingTotal > 0) lines.push(`Meetings took ${formatMinutes(meetingTotal)} of your ${this.state.capacityHours}h day.`);
    if (tomorrow > 0) lines.push(`${tomorrow} pushed to tomorrow.`);
    if (dropping > 0) lines.push(`${dropping} in Drop will be cleared.`);
    if (carrying > 0) lines.push(`${carrying} still in Now ${carrying === 1 ? 'carries' : 'carry'} over.`);
    else if (tomorrow === 0 && dropping === 0) lines.push('Flick unfinished tiles left to push them to tomorrow.');
    const bias = biasLine(this.state.completions);
    if (bias) lines.push(bias);
    else if (this.state.completions.length < MIN_SAMPLES) lines.push("I'll learn how long your tasks really take after a few finished days.");
    else lines.push('Your estimates are on track so far.');
    this.setText(this.recapText, lines.join(' '));
    this.recapOpen = true;
    this.recapCard.setProperties({ display: 'flex' });
    this.refreshCards();
    this.relayout();
    this.setStatus('Sweep finished tiles into the jar, then End day');
  }

  private closeRecap(): void {
    if (!this.recapOpen) return;
    this.recapOpen = false;
    this.recapCard?.setProperties({ display: 'none' });
    this.refreshCards();
    this.relayout();
  }

  private confirmEndDay(): void {
    const dropped = endDay(this.state);
    this.sounds.play('endDay');
    this.companion?.say(`Nice work today. ${this.state.streak}-day streak. See you tomorrow.`);
    for (const id of dropped) {
      const entity = this.tilesById.get(id);
      if (entity && !entity.hasComponent(Grabbed)) this.removeTile(id, entity);
    }
    this.closeRecap();
    this.relayout();
    this.refreshJar();
    this.setStatus(
      `Day ended. ${this.state.streak}-day streak. See you tomorrow`,
    );
    this.scheduleSave();
  }

  // --- layout, capacity and feedback ------------------------------------

  /** Recomputes every tile's resting spot, zone stacks and the capacity overflow. */
  private relayout(): void {
    const byZone = new Map<Zone, StoredTask[]>();
    for (const zone of Object.values(Zone)) byZone.set(zone, []);
    // The focused tile floats on its own; it keeps its zone but leaves the pile.
    const focusId = this.state.focusTaskId;
    const focused = this.focusTask;
    for (const task of this.state.tasks) if (task.id !== focusId) byZone.get(task.zone)!.push(task);
    for (const list of byZone.values()) {
      list.sort((a, b) => a.order - b.order);
      list.forEach((task, index) => (task.order = index + 1));
    }

    const capacityTop = TRAY.surfaceY + this.state.capacityHours * METRES_PER_HOUR;
    let nowMinutes = focused?.zone === Zone.Now ? focused.minutes : 0;
    let meetingMinutes = 0;
    let anyOverflow = false;
    for (const zone of STACK_ZONES) {
      const centre = ZONE_CENTRE[zone];
      let y = TRAY.surfaceY;
      const stack = byZone.get(zone)!;
      stack.forEach((task, index) => {
        const h = tileThickness(task.minutes);
        // Judge overflow on minutes, not stack height, so the tiny gaps between
        // tiles never push an exactly-full day over the line.
        if (zone === Zone.Now) nowMinutes += task.minutes;
        const overflow = zone === Zone.Now && nowMinutes > this.state.capacityHours * 60;
        anyOverflow ||= overflow;
        if (task.kind === 'meeting') meetingMinutes += task.minutes;
        // Meetings are fixed weight at the bottom of Now: never grabbable.
        const grabbable = index === stack.length - 1 && task.kind !== 'meeting';
        this.applyLayout(task, centre.x, y + h / 2, centre.z, overflow, grabbable);
        y += h + STACK_GAP;
      });
    }

    const grid = this.state.settings.largeTiles ? INBOX_GRID.large : INBOX_GRID.normal;
    const columns = [0, 0, 0, 0, 0];
    const inbox = byZone.get(Zone.Inbox)!;
    inbox.forEach((task, index) => {
      const column = index % grid.columns;
      const h = tileThickness(task.minutes);
      const x = TRAY.inbox.x + (column - (grid.columns - 1) / 2) * grid.spacing;
      const topOfColumn = index + grid.columns >= inbox.length;
      this.applyLayout(task, x, TRAY.surfaceY + columns[column] + h / 2, TRAY.inbox.z, false, topOfColumn);
      columns[column] += h + STACK_GAP;
    });
    if (focused) {
      const spot = this.focusSpot();
      this.applyLayout(focused, spot.x, spot.y, spot.z, false, true);
    }

    if (anyOverflow && !this.wasOverflowing) {
      this.soundAt.set(TRAY.zones.Now.x, capacityTop, TRAY.zones.Now.z);
      this.tray.localToWorld(this.soundAt);
      this.sounds.play('overflow', this.soundAt);
    }
    this.wasOverflowing = anyOverflow;
    this.capacityLine.position.y = capacityTop;
    this.capacityTop = capacityTop;
    this.refreshCoach();
    this.capacityMaterial.color.setHex(anyOverflow ? 0xff5a4f : 0x5fe0d0);
    this.capacityMaterial.opacity = anyOverflow ? 0.5 : 0.35; // tickOverflowFlash brightens it the first time
    const over = nowMinutes - this.state.capacityHours * 60;
    this.setText(
      this.capacityText,
      `Now ${formatMinutes(nowMinutes)} / ${this.state.capacityHours}h` +
        (meetingMinutes > 0 ? ` (${formatMinutes(meetingMinutes)} meetings)` : '') +
        (over > 0 ? `  -  over by ${formatMinutes(over)}` : ''),
    );
    this.updateNudge(byZone.get(Zone.Now)!.filter((task) => task.kind !== 'meeting'), over);
  }

  // --- capacity nudge ---------------------------------------------------

  /**
   * One suggestion when Now overflows: move the lowest-priority tiles that
   * bring Now back under the line, preferring a single tile when one suffices.
   */
  private updateNudge(nowTasks: StoredTask[], over: number): void {
    let picks: StoredTask[] = [];
    if (over > 0 && nowTasks.length > 0) {
      const lowest = Math.max(...nowTasks.map((task) => task.priority));
      const single = nowTasks
        .filter((task) => task.priority === lowest && task.minutes >= over)
        .sort((a, b) => a.minutes - b.minutes)[0];
      if (single) {
        picks = [single];
      } else {
        const ranked = [...nowTasks].sort((a, b) => b.priority - a.priority || b.order - a.order);
        let freed = 0;
        for (const task of ranked) {
          if (freed >= over) break;
          picks.push(task);
          freed += task.minutes;
        }
      }
    }
    this.nudgeKey = `${picks.map((task) => task.id).sort((a, b) => a - b).join(',')}@${this.state.capacityHours}`;
    // Wind-down is for clearing the day, not replanning it: no nudge while the recap is open.
    // Overflow is the core moment, so the nudge outranks a pending split offer (which waits).
    const show =
      picks.length > 0 && this.nudgeKey !== this.dismissedNudge && !this.recapOpen && !this.pendingTook && !this.readerOpen();
    if (show && !this.nudgeVisible) {
      // The core moment: the buddy says why, and the very first time it lands harder.
      const firstTime = !this.state.onboarding.overflowSeen;
      if (firstTime) {
        this.state.onboarding.overflowSeen = true;
        this.overflowFlash = OVERFLOW_FLASH_SECONDS;
        this.scheduleSave();
      }
      let meetingMinutes = 0;
      for (const task of this.state.tasks) if (task.kind === 'meeting' && task.zone === Zone.Now) meetingMinutes += task.minutes;
      this.companion?.say(
        nudgeWhy(picks, meetingMinutes > 0 ? formatMinutes(meetingMinutes) : undefined, formatMinutes(over), firstTime),
        10,
      );
    }
    this.nudgeVisible = show;
    this.refreshSplitCard();
    this.nudgeTaskIds = show ? picks.map((task) => task.id) : [];
    this.nudgeCard?.setProperties({ display: show ? 'flex' : 'none' });
    if (!show) return;
    const names = picks.map((task) => `"${task.title}"`);
    const list =
      names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
    const reason = picks.every((task) => task.priority === 3)
      ? ' (low priority)'
      : picks.some((task) => task.priority === 1)
        ? ' (even though some are urgent)'
        : '';
    this.setText(
      this.nudgeText,
      `Now is ${formatMinutes(over)} over your ${this.state.capacityHours}h day. Move ${list}${reason} to Later?`,
    );
  }

  private acceptNudge(): void {
    const ids = this.nudgeTaskIds;
    if (ids.length === 0) return;
    const moved: StoredTask[] = [];
    for (const task of this.state.tasks) {
      if (!ids.includes(task.id) || task.zone !== Zone.Now) continue;
      task.zone = Zone.Later;
      task.order = this.maxOrder(Zone.Later) + 1;
      moved.push(task);
    }
    if (moved.length > 0) this.companion?.say(nudgeDone(moved, this.state.capacityHours), 6);
    this.relayout();
    this.setStatus(`Moved ${ids.length === 1 ? '1 tile' : `${ids.length} tiles`} to Later. Now fits your day`);
    this.scheduleSave();
  }

  private dismissNudge(): void {
    this.dismissedNudge = this.nudgeKey;
    this.relayout();
    this.setStatus('Keeping the plan as it is');
  }

  private applyLayout(
    task: StoredTask,
    x: number,
    y: number,
    z: number,
    overflow: boolean,
    grabbable: boolean,
  ): void {
    const entity = this.tilesById.get(task.id);
    if (!entity) return;
    // Thin tiles in a pile sit millimetres apart, so proximity grab could pick the
    // wrong one. Only the top of each pile is grabbable; never touch a held tile.
    if (!entity.hasComponent(Grabbed)) {
      const has = entity.hasComponent(OneHandGrabbable);
      if (grabbable && !has) entity.addComponent(OneHandGrabbable, {});
      else if (!grabbable && has) entity.removeComponent(OneHandGrabbable);
    }
    entity.setValue(TaskTile, 'zone', task.zone);
    entity.setValue(TaskTile, 'order', task.order);
    const target = entity.getVectorView(TaskTile, 'target');
    target[0] = x;
    target[1] = y;
    target[2] = z;
    if (entity.getValue(TaskTile, 'overflow') !== overflow) {
      entity.setValue(TaskTile, 'overflow', overflow);
      setTileOverflow(entity.object3D as Mesh, overflow);
    }
  }

  private refreshJar(): void {
    const { count, minutes } = this.state.jar;
    // Fills quickly at first, then ever more slowly, split into one layer per week.
    const layers = jarLayers(this.state, STRATA_POOL - 2);
    const total = layers.reduce((sum, layer) => sum + layer.count, 0);
    const height = total > 0 ? JAR.maxFill * (1 - Math.exp(-total / 40)) : 0;
    let y = JAR.floor;
    this.strata.forEach((mesh, i) => {
      const layer = layers[i];
      mesh.visible = layer !== undefined;
      if (!layer) return;
      const h = Math.max(MIN_LAYER_HEIGHT, (height * layer.count) / total);
      const color = layer.current
        ? CURRENT_COLOR
        : layer.week === 'earlier'
          ? EARLIER_COLOR
          : STRATA_COLORS[i % STRATA_COLORS.length];
      const material = mesh.material as MeshStandardMaterial;
      material.color.setHex(color);
      material.emissive.setHex(color);
      material.emissiveIntensity = layer.current ? 0.55 : 0.25;
      mesh.position.y = y;
      mesh.scale.y = h;
      y += h;
    });
    const tomorrow = this.state.tasks.filter((task) => task.zone === Zone.Tomorrow).length;
    // A streak is alive if the last ended day is today or yesterday.
    const alive = this.state.lastEndedDay === this.state.day || this.state.lastEndedDay === previousDay(this.state.day);
    const streak = alive && this.state.streak > 1 ? this.state.streak : 0;
    this.setText(
      this.jarText,
      `Done jar: ${count} ${count === 1 ? 'task' : 'tasks'}, ${formatMinutes(minutes)}` +
        (streak > 0 ? `  |  ${streak}-day streak` : '') +
        (tomorrow > 0 ? `  |  Tomorrow: ${tomorrow}` : ''),
    );
  }

  private setStatus(text: string): void {
    this.lastStatus = text;
    this.setText(this.statusText, text);
  }

  private setText(element: TextElement | undefined, text: string): void {
    element?.setProperties({ text });
  }

  private scheduleSave(): void {
    this.saveCountdown = SAVE_DELAY;
  }

  private syncPlacementStatus(): void {
    const desk = this.queries.desk.entities.values().next().value as Entity | undefined;
    if (!desk) return;
    const state = desk.getValue(DeskPlacement, 'state') as string;
    if (state === this.placementState) return;
    const previous = this.placementState;
    this.placementState = state;
    const message = PLACEMENT_STATUS[state];
    if (message) this.setStatus(message);
    if (state === PlacementState.Placed) markMoment('trayPlacedAt');
    if (state === PlacementState.Placed && previous !== '') {
      // The tray moved onto the real desk: let every tile drop into its new spot.
      for (const entity of this.tilesById.values()) {
        const object = entity.object3D;
        if (!object) continue;
        object.userData.spawnDrop = 0.08;
        object.userData.needsSnap = true;
      }
      if (desk.getValue(DeskPlacement, 'source') === 'anchor') {
        this.setStatus('Welcome back. Your desk is where you left it');
        this.companion?.say('Welcome back. Your desk is where you left it.', 6);
      } else {
        this.setStatus('Tray placed on your desk. Add a task to begin');
      }
    }
  }

  /** Finds the grabbable tile nearest either hand (within HOVER_RADIUS) and marks it hovered. */
  private updateHover(): void {
    const grips = this.player.gripSpaces;
    const hasLeft = grips.left !== undefined;
    const hasRight = grips.right !== undefined;
    if (hasLeft) grips.left!.getWorldPosition(this.gripLeft);
    if (hasRight) grips.right!.getWorldPosition(this.gripRight);
    let best: Entity | undefined;
    let bestDistance = this.state.settings.largeTiles ? HOVER_RADIUS_LARGE : HOVER_RADIUS;
    if (hasLeft || hasRight) {
      for (const entity of this.queries.resting.entities) {
        const object = entity.object3D;
        if (!object || !entity.hasComponent(OneHandGrabbable) || entity.getValue(TaskTile, 'focused')) continue;
        object.getWorldPosition(this.hoverPos);
        const d = Math.min(
          hasLeft ? this.hoverPos.distanceTo(this.gripLeft) : Infinity,
          hasRight ? this.hoverPos.distanceTo(this.gripRight) : Infinity,
        );
        if (d < bestDistance) {
          bestDistance = d;
          best = entity;
        }
      }
    }
    if (best === this.hovered) return;
    if (this.hovered?.object3D) setTileHover(this.hovered.object3D as Mesh, false);
    if (best?.object3D) setTileHover(best.object3D as Mesh, true);
    this.hovered = best;
  }

  // --- Look to select (accessibility) --------------------------------------------

  /**
   * Hands-free input: hold the head on a panel button to press it; on a tile to pick it,
   * then on a zone or the jar to move it there. Works on every headset (head direction);
   * in the browser the mouse already does this, so it only runs in XR.
   */
  private updateLookSelect(delta: number): void {
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!this.state.settings.lookToSelect || !inXR || this.queries.held.entities.size > 0) {
      if (this.lookVisual?.root.visible) this.lookVisual.hide();
      this.dwell.reset();
      if (!this.state.settings.lookToSelect && this.lookPicked) this.clearLookPick();
      return;
    }
    if (!this.lookVisual) {
      this.lookVisual = new LookSelectVisual();
      this.lookVisual.setContrast(this.state.settings.highContrast);
      this.world.createTransformEntity(this.lookVisual.root);
    }
    const head = this.player.head;
    head.getWorldPosition(this.lookOrigin);
    head.getWorldDirection(this.lookForward).negate(); // the head looks down its local -Z
    this.lookCount = 0;
    for (const action of this.panelActions) {
      if (action.element.isVisible && !action.element.isVisible.peek()) continue;
      action.element.getWorldPosition(this.world3);
      this.addLook(action.lookId, this.world3, LOOK_RADIUS.button);
    }
    const picked = this.lookPicked;
    const tileHalf = this.state.settings.largeTiles ? LOOK_RADIUS.tileHalfWidth * 1.3 : LOOK_RADIUS.tileHalfWidth;
    for (const entity of this.queries.resting.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const id = entity.getValue(TaskTile, 'taskId') as number;
      // Before a pick, only grabbable (top) tiles; after, only the picked tile (look back to cancel).
      if (picked ? id !== picked.id : !entity.hasComponent(OneHandGrabbable)) continue;
      let lookId = this.tileLookIds.get(id);
      if (!lookId) this.tileLookIds.set(id, (lookId = `tile:${id}`));
      object.getWorldPosition(this.world3);
      this.addLook(lookId, this.world3, this.lookAngle(tileHalf, this.world3));
    }
    if (picked) {
      for (const zone of STACK_ZONES) {
        const c = ZONE_CENTRE[zone];
        this.world3.set(c.x, TRAY.surfaceY, c.z);
        this.tray.localToWorld(this.world3);
        this.addLook(LOOK_ZONE_IDS[zone], this.world3, this.lookAngle(LOOK_RADIUS.zoneHalfWidth, this.world3));
      }
      this.world3.set(TRAY.inbox.x, TRAY.surfaceY, TRAY.inbox.z);
      this.tray.localToWorld(this.world3);
      this.addLook(LOOK_ZONE_IDS[Zone.Inbox], this.world3, this.lookAngle(LOOK_RADIUS.zoneHalfWidth, this.world3));
      this.jar.getWorldPosition(this.world3);
      this.world3.y += 0.07;
      this.addLook('jar', this.world3, this.lookAngle(0.06, this.world3));
    }
    if (this.lookSuppressed) {
      // Released once the head turns away from where the tile went (it may still be flying there).
      this.world3.copy(this.lookSuppressAt).sub(this.lookOrigin);
      if (this.world3.angleTo(this.lookForward) > (10 * Math.PI) / 180) this.lookSuppressed = undefined;
    }
    let target = pickTarget(this.lookOrigin, this.lookForward, this.lookSlots, this.lookCount);
    if (target && target.id === this.lookSuppressed) target = undefined;
    const { progress, fired } = this.dwell.update(target?.id, delta);
    if (target) this.lookCursor.copy(target.position);
    else this.lookCursor.copy(this.lookOrigin).addScaledVector(this.lookForward, 0.6);
    this.lookVisual.show(this.lookCursor, this.lookOrigin, progress, target !== undefined);
    if (fired) this.onLookFired(fired);
  }

  private addLook(id: string, position: Vector3, radiusDeg: number): void {
    if (this.lookCount >= MAX_LOOK_CANDIDATES) return;
    const slot = this.lookSlots[this.lookCount++];
    slot.id = id;
    slot.position.copy(position);
    slot.radiusDeg = radiusDeg;
  }

  /** Angular half-size (degrees) of something `halfWidth` metres wide at `at`. */
  private lookAngle(halfWidth: number, at: Vector3): number {
    return (Math.atan2(halfWidth, Math.max(0.1, at.distanceTo(this.lookOrigin))) * 180) / Math.PI;
  }

  private onLookFired(id: string): void {
    if (id.startsWith('btn:')) {
      this.panelActions.find((action) => action.lookId === id)?.run();
      return;
    }
    const picked = this.lookPicked;
    if (id.startsWith('tile:')) {
      const task = this.state.tasks.find((t) => t.id === Number(id.slice(5)));
      if (!task) return;
      if (picked === task) {
        this.clearLookPick();
        this.setStatus(`Put "${task.title}" back`);
        return;
      }
      this.lookPicked = task;
      const object = this.tilesById.get(task.id)?.object3D;
      if (object) setTileHover(object as Mesh, true);
      this.sounds.play('pop');
      this.setStatus(`Now look at Now, Later, Drop or the jar to move "${task.title}"`);
      return;
    }
    if (!picked || !this.state.tasks.includes(picked)) {
      this.clearLookPick();
      return;
    }
    const entity = this.tilesById.get(picked.id);
    this.clearLookPick();
    if (!entity) return;
    this.lookSuppressed = this.tileLookIds.get(picked.id);
    this.lookSuppressAt.copy(this.lookCursor); // where the user was looking when it fired
    if (this.state.focusTaskId === picked.id) this.stopFocus();
    if (id === 'jar') {
      this.completeTask(entity, picked);
      return;
    }
    const zone = id.slice(5) as Zone;
    if (zone !== picked.zone) {
      const where = this.assignZone(picked, zone);
      this.setStatus(`${picked.title} moved to ${where}`);
      this.sounds.play('snap');
    }
    this.relayout();
    this.scheduleSave();
  }

  private clearLookPick(): void {
    const object = this.lookPicked && this.tilesById.get(this.lookPicked.id)?.object3D;
    if (object && this.hovered?.object3D !== object) setTileHover(object as Mesh, false);
    this.lookPicked = undefined;
  }

  /** The first overflow flares the red line once, on top of the usual wobble and sound. */
  private tickOverflowFlash(delta: number): void {
    if (this.overflowFlash <= 0) return;
    this.overflowFlash = Math.max(0, this.overflowFlash - delta);
    if (!this.wasOverflowing) return;
    const t = this.overflowFlash / OVERFLOW_FLASH_SECONDS;
    const pulse = this.state.settings.reduceMotion ? t : t * (0.6 + 0.4 * Math.abs(Math.sin(this.overflowFlash * 9)));
    this.capacityMaterial.opacity = 0.5 + 0.45 * pulse;
  }

  /**
   * The draft sheet can be picked up and put down anywhere: on release it settles flat on the
   * desk (or the tray) where it was let go, and from then on moves with the tray.
   */
  private updateDraftSheet(): void {
    const entity = this.draftSheetEntity;
    const object = entity?.object3D;
    if (!entity || !object || !object.visible) return;
    if (entity.hasComponent(Grabbed)) {
      this.sheetHeld = true;
      return;
    }
    if (this.sheetHeld) {
      this.sheetHeld = false;
      this.local3.copy(object.position);
      this.tray.worldToLocal(this.local3);
      const onTray = Math.abs(this.local3.x) < TRAY.width / 2 && Math.abs(this.local3.z) < TRAY.depth / 2;
      const farAway = Math.abs(this.local3.x) > 0.8 || Math.abs(this.local3.z) > 0.6;
      if (farAway) this.sheetLocal.set(SHEET_HOME.x, SHEET_LIFT, SHEET_HOME.z);
      else this.sheetLocal.set(this.local3.x, (onTray ? TRAY.surfaceY : 0) + SHEET_LIFT, this.local3.z);
      this.sounds.play('snap', this.world3.copy(object.position));
      this.endSheetHint();
    }
    this.world3.copy(this.sheetLocal);
    this.tray.localToWorld(this.world3);
    object.position.copy(this.world3);
    object.quaternion.copy(this.trayQuat).multiply(this.sheetFlat);
  }

  /** The first draft sheet ever: the coach's ghost and pinch show it can be picked up and placed. */
  private startSheetHint(): void {
    if (this.state.onboarding.sheetHintDone) return;
    this.state.onboarding.sheetHintDone = true;
    this.scheduleSave();
    this.sheetHintTimer = SHEET_HINT_SECONDS;
    this.coach?.showSheet(
      { x: this.sheetLocal.x, y: this.sheetLocal.y + 0.006, z: this.sheetLocal.z },
      { x: this.sheetLocal.x, y: this.sheetLocal.y + 0.006, z: this.sheetLocal.z + 0.15 },
    );
    this.refreshCoach();
  }

  private endSheetHint(): void {
    if (this.sheetHintTimer <= 0) return;
    this.sheetHintTimer = 0;
    this.coach?.hideSheet();
    this.refreshCoach();
  }

  /** Button fallback for moving the sheet by hand: steps it between a few spots by the tray. */
  private moveSheetByButton(): void {
    if (!this.draftSheet?.visible) return;
    this.sheetSpot = (this.sheetSpot + 1) % SHEET_SPOTS.length;
    const spot = SHEET_SPOTS[this.sheetSpot];
    this.sheetLocal.set(spot.x, SHEET_LIFT, spot.z);
    this.sounds.play('snap');
    this.setStatus('Draft sheet moved');
    this.endSheetHint();
  }

  /** Whether a released tile at `point` would land with the buddy. */
  private isOverBuddy(point: Vector3): boolean {
    if (!this.buddyNode) return false;
    this.buddyNode.getWorldPosition(this.buddyWorld);
    const dy = point.y - this.buddyWorld.y;
    return Math.hypot(point.x - this.buddyWorld.x, point.z - this.buddyWorld.z) < BUDDY_CATCH_RADIUS && dy > -0.03 && dy < 0.25;
  }

  /** Hands have no hover cue: the buddy raises its hands while a held tile is over it. */
  private trackBuddyCatch(): void {
    let over = false;
    for (const entity of this.queries.held.entities) {
      const object = entity.object3D;
      if (!object) continue;
      object.getWorldPosition(this.world3);
      if (this.isOverBuddy(this.world3)) over = true;
    }
    if (over === this.buddyReady) return;
    this.buddyReady = over;
    this.companion?.setReady(over);
    if (over) {
      this.statusBeforeCatch = this.lastStatus;
      this.setStatus('Let go to hand it to your buddy: it writes a first draft');
    } else if (this.queries.held.entities.size > 0) {
      this.setStatus(this.statusBeforeCatch || 'Pinch a tile and drop it in a zone');
    }
  }

  /** Remembers each held tile's recent peak leftward speed (tray-relative) for flick detection. */
  private trackFlicks(delta: number): void {
    if (delta <= 0) return;
    const decay = Math.exp(-delta / FLICK_MEMORY);
    for (const entity of this.queries.held.entities) {
      const object = entity.object3D;
      if (!object) continue;
      object.getWorldPosition(this.world3);
      const data = object.userData;
      if (data.tracked) {
        const vx = (this.world3.x - (data.lastX as number)) / delta;
        const vz = (this.world3.z - (data.lastZ as number)) / delta;
        const leftward = -(vx * this.trayRight.x + vz * this.trayRight.z);
        data.flick = Math.max(leftward, ((data.flick as number) ?? 0) * decay);
      }
      if (!data.tracked) {
        data.startX = this.world3.x; // where this hold began, for the flick travel check
        data.startZ = this.world3.z;
      }
      data.lastX = this.world3.x;
      data.lastZ = this.world3.z;
      data.tracked = true;
    }
  }

  update(delta: number, time: number): void {
    if (!this.bound && !this.tryBind()) return;
    if (this.saveCountdown > 0) {
      this.saveCountdown -= delta;
      if (this.saveCountdown <= 0 && !this.resetting) void saveState(this.state);
    }
    this.syncPlacementStatus();
    this.dayCheck -= delta;
    if (this.dayCheck <= 0) {
      this.dayCheck = DAY_CHECK_SECONDS;
      if (this.state.day !== planDay()) this.applyRollover();
    }

    this.tray.updateWorldMatrix(true, false);
    this.tray.getWorldQuaternion(this.trayQuat);
    this.trayRight.set(1, 0, 0).applyQuaternion(this.trayQuat);
    this.trackFlicks(delta);
    this.trackBuddyCatch();
    this.updateDraftSheet();
    this.tickOverflowFlash(delta);
    this.tickFocus(delta);
    this.updateHover();
    this.updateLookSelect(delta);
    this.sounds.updateListener(this.player.head);
    this.tickCoach(delta);
    this.nextCheck -= delta;
    if (this.nextCheck <= 0) {
      this.nextCheck = NEXT_MEETING_CHECK_SECONDS;
      this.refreshNextMeeting();
    }
    // In the browser the rendered camera is not the XR head: face whichever one is drawing.
    const viewer = this.world.visibilityState.peek() === VisibilityState.NonImmersive ? this.world.camera : this.player.head;
    this.companion?.update(delta, viewer);
    if (this.touchedTimer > 0) {
      this.touchedTimer -= delta;
      if (this.touchedTimer <= 0) this.hideTileActions();
    }
    if (this.undoTimer > 0) {
      this.undoTimer -= delta;
      if (this.undoTimer <= 0) this.clearUndo();
    }
    const k = 1 - Math.exp(-14 * delta);
    for (const entity of this.queries.resting.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const target = entity.getVectorView(TaskTile, 'target');
      this.world3.set(target[0], target[1], target[2]);
      this.tray.localToWorld(this.world3);
      if (entity === this.hovered) this.world3.y += HOVER_LIFT;
      const snap = object.userData.needsSnap === true;
      if (snap) this.world3.y += (object.userData.spawnDrop as number) ?? 0;
      if (snap && object.userData.spawnAt) {
        // Split pieces start where the big tile cracked, then fly to their spots.
        this.world3.copy(object.userData.spawnAt as Vector3);
        object.userData.spawnAt = undefined;
      }
      object.parent?.worldToLocal(this.world3);

      this.targetQuat.copy(this.trayQuat);
      if (entity.getValue(TaskTile, 'focused')) this.targetQuat.multiply(this.focusTilt);
      if (entity.getValue(TaskTile, 'overflow') && !this.state.settings.reduceMotion) {
        const phase = time * 9 + entity.getValue(TaskTile, 'taskId')!;
        this.wobble.setFromAxisAngle(this.wobbleAxis, Math.sin(phase) * 0.07);
        this.targetQuat.multiply(this.wobble);
      }
      if (snap) {
        object.position.copy(this.world3);
        object.quaternion.copy(this.targetQuat);
        object.userData.needsSnap = false;
      } else {
        object.position.lerp(this.world3, k);
        object.quaternion.slerp(this.targetQuat, k);
      }
    }
  }
}
