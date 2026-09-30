import {
  BoxGeometry,
  CanvasTexture,
  createSystem,
  DoubleSide,
  Grabbed,
  Mesh,
  MeshBasicMaterial,
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
import { splitBrainDump, type DraftTask } from './brain-dump.js';
import { speechRecognitionConstructor, type SpeechRecognitionLike } from './speech.js';
import { DeskPlacement, PlacementState, TaskTile, Zone } from './planner-components.js';
import { emptyState, loadState, saveState, type PlannerState, type StoredTask } from './planner-store.js';
import { TRAY } from './scene-assets/day-tray.scene-asset.js';
import { JAR } from './scene-assets/done-jar.scene-asset.js';
import {
  createTileMesh,
  disposeTileMaterials,
  formatMinutes,
  METRES_PER_MINUTE,
  setTileOverflow,
  tileThickness,
} from './task-tile-visual.js';

/** Capacity line rises 2 cm per available hour (same scale as tile thickness). */
const METRES_PER_HOUR = 60 * METRES_PER_MINUTE;
const ZONE_MARGIN = 0.025;
const MAX_DROP_HEIGHT = 0.3;
const JAR_CATCH_RADIUS = 0.08;
const JAR_CATCH_HEIGHT = 0.3;
const INBOX_COLUMNS = 5;
const INBOX_SPACING = 0.108;
const STACK_GAP = 0.0004;
const SAVE_DELAY = 0.6;
const STACK_ZONES = [Zone.Now, Zone.Later, Zone.Drop] as const;
const ZONE_CENTRE: Record<(typeof STACK_ZONES)[number], { x: number; z: number }> = {
  [Zone.Now]: TRAY.zones.Now,
  [Zone.Later]: TRAY.zones.Later,
  [Zone.Drop]: TRAY.zones.Drop,
};
const PLACEMENT_STATUS: Record<string, string> = {
  [PlacementState.Searching]: 'Looking for your desk...',
  [PlacementState.Placing]: 'No table found. Point at your desk and pinch to place the tray',
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
      this.queries.held.subscribe('qualify', () =>
        this.setStatus('Drop it on Now, Later or Drop, or in the jar when done'),
      ),
      this.queries.held.subscribe('disqualify', (entity) => this.onRelease(entity)),
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
    this.statusText = panel.getElementById('status-text') as TextElement;
    this.jarText = panel.getElementById('jar-text') as TextElement;
    const on = (id: string, handler: () => void) => {
      const element = panel.getElementById(id);
      if (!element) return;
      element.name = id;
      element.addEventListener('click', handler);
      this.cleanupFuncs.push(() => element.removeEventListener('click', handler));
    };
    on('hours-down', () => this.changeCapacity(-1));
    on('hours-up', () => this.changeCapacity(1));
    on('add-15', () => this.addTask(15));
    on('add-30', () => this.addTask(30));
    on('add-60', () => this.addTask(60));
    on('add-120', () => this.addTask(120));
    this.nudgeCard = panel.getElementById('nudge-card') as UIKit.Container | undefined;
    this.nudgeText = panel.getElementById('nudge-text') as TextElement | undefined;
    on('nudge-accept', () => this.acceptNudge());
    on('nudge-dismiss', () => this.dismissNudge());
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
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((visibility) => {
        const is2D = visibility === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      }),
    );
  }

  /** Pinch "Dictate" in XR, speak, pinch "Done": the transcript becomes a brain dump. */
  private bindDictation(panel: UIKitMLAsset, on: (id: string, handler: () => void) => void): void {
    const Recognition = speechRecognitionConstructor();
    const button = panel.getElementById('dictate-button');
    const label = panel.getElementById('dictate-label') as TextElement | undefined;
    if (!Recognition || !button) return; // no speech support: the button stays hidden
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

  // --- tasks -------------------------------------------------------------

  private spawnSavedTiles(): void {
    for (const task of this.state.tasks) {
      task.priority ??= 2; // tasks saved before priorities existed
      this.createTile(task, false);
    }
    this.relayout();
    this.refreshJar();
    this.setStatus(
      this.state.tasks.length === 0
        ? 'Add a task, then pinch its tile into a zone'
        : 'Pinch a tile and drop it in a zone',
    );
  }

  private addTask(minutes: number): void {
    if (!this.bound) return;
    const task = this.pushTask({ title: `Task ${this.state.nextId}`, minutes, priority: 2 });
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
    try {
      const { tasks, source } = await splitBrainDump(trimmed);
      for (const draft of tasks) this.pushTask(draft);
      this.relayout();
      this.scheduleSave();
      const total = tasks.reduce((sum, task) => sum + task.minutes, 0);
      this.setStatus(
        tasks.length === 0
          ? 'No tasks found in that. Try one task per line'
          : `${source === 'agent' ? 'Agent made' : 'Made (offline)'} ${tasks.length} tiles, ${formatMinutes(total)} in all. Sort them by hand`,
      );
      return tasks.length;
    } finally {
      this.splitting = false;
    }
  }

  private createTile(task: StoredTask, dropIn: boolean): void {
    const mesh = createTileMesh(task.title, task.minutes, task.priority);
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
    object.getWorldPosition(this.world3);

    this.jar.getWorldPosition(this.jarWorld);
    const dx = this.world3.x - this.jarWorld.x;
    const dz = this.world3.z - this.jarWorld.z;
    const dy = this.world3.y - this.jarWorld.y;
    if (Math.hypot(dx, dz) < JAR_CATCH_RADIUS && dy > -0.02 && dy < JAR_CATCH_HEIGHT) {
      this.completeTask(entity, task);
      return;
    }

    this.tray.updateWorldMatrix(true, false);
    this.local3.copy(this.world3);
    this.tray.worldToLocal(this.local3);
    const zone = this.zoneAt(this.local3);
    if (zone && zone !== task.zone) {
      task.zone = zone;
      task.order = this.maxOrder(zone) + 1;
      this.setStatus(`${task.title} moved to ${zone === Zone.Inbox ? 'Inbox' : zone[0].toUpperCase() + zone.slice(1)}`);
    } else if (!zone) {
      this.setStatus(`${task.title} went back. Drop it over a zone`);
    }
    this.relayout();
    this.scheduleSave();
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
    this.state.jar.count += 1;
    this.state.jar.minutes += task.minutes;
    this.state.tasks = this.state.tasks.filter((t) => t.id !== task.id);
    this.tilesById.delete(task.id);
    const mesh = entity.object3D as Mesh;
    disposeTileMaterials(mesh);
    entity.dispose();
    this.relayout();
    this.refreshJar();
    this.setStatus(`Done: ${task.title}. Into the jar`);
    this.scheduleSave();
  }

  // --- layout, capacity and feedback ------------------------------------

  /** Recomputes every tile's resting spot, zone stacks and the capacity overflow. */
  private relayout(): void {
    const byZone = new Map<Zone, StoredTask[]>();
    for (const zone of Object.values(Zone)) byZone.set(zone, []);
    for (const task of this.state.tasks) byZone.get(task.zone)!.push(task);
    for (const list of byZone.values()) {
      list.sort((a, b) => a.order - b.order);
      list.forEach((task, index) => (task.order = index + 1));
    }

    const capacityTop = TRAY.surfaceY + this.state.capacityHours * METRES_PER_HOUR;
    let nowMinutes = 0;
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
        this.applyLayout(task, centre.x, y + h / 2, centre.z, overflow, index === stack.length - 1);
        y += h + STACK_GAP;
      });
    }

    const columns = [0, 0, 0, 0, 0];
    const inbox = byZone.get(Zone.Inbox)!;
    inbox.forEach((task, index) => {
      const column = index % INBOX_COLUMNS;
      const h = tileThickness(task.minutes);
      const x = TRAY.inbox.x + (column - (INBOX_COLUMNS - 1) / 2) * INBOX_SPACING;
      const topOfColumn = index + INBOX_COLUMNS >= inbox.length;
      this.applyLayout(task, x, TRAY.surfaceY + columns[column] + h / 2, TRAY.inbox.z, false, topOfColumn);
      columns[column] += h + STACK_GAP;
    });

    this.capacityLine.position.y = capacityTop;
    this.capacityMaterial.color.setHex(anyOverflow ? 0xff5a4f : 0x5fe0d0);
    this.capacityMaterial.opacity = anyOverflow ? 0.5 : 0.35;
    const over = nowMinutes - this.state.capacityHours * 60;
    this.setText(
      this.capacityText,
      `Now ${formatMinutes(nowMinutes)} / ${this.state.capacityHours}h` +
        (over > 0 ? `  -  over by ${formatMinutes(over)}` : ''),
    );
    this.updateNudge(byZone.get(Zone.Now)!, over);
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
    const show = picks.length > 0 && this.nudgeKey !== this.dismissedNudge;
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
    for (const task of this.state.tasks) {
      if (!ids.includes(task.id) || task.zone !== Zone.Now) continue;
      task.zone = Zone.Later;
      task.order = this.maxOrder(Zone.Later) + 1;
    }
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
    // Fills quickly at first, then ever more slowly, so it never visibly tops out.
    this.jarFill.scale.y = Math.max(0.002, JAR.maxFill * (1 - Math.exp(-count / 40)));
    this.setText(this.jarText, `Done jar: ${count} ${count === 1 ? 'task' : 'tasks'}, ${formatMinutes(minutes)}`);
  }

  private setStatus(text: string): void {
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
    if (state === PlacementState.Placed && previous !== '') {
      // The tray moved onto the real desk: let every tile drop into its new spot.
      for (const entity of this.tilesById.values()) {
        const object = entity.object3D;
        if (!object) continue;
        object.userData.spawnDrop = 0.08;
        object.userData.needsSnap = true;
      }
      this.setStatus('Tray placed on your desk. Add a task to begin');
    }
  }

  update(delta: number, time: number): void {
    if (!this.bound && !this.tryBind()) return;
    if (this.saveCountdown > 0) {
      this.saveCountdown -= delta;
      if (this.saveCountdown <= 0) void saveState(this.state);
    }
    this.syncPlacementStatus();

    this.tray.updateWorldMatrix(true, false);
    this.tray.getWorldQuaternion(this.trayQuat);
    const k = 1 - Math.exp(-14 * delta);
    for (const entity of this.queries.resting.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const target = entity.getVectorView(TaskTile, 'target');
      this.world3.set(target[0], target[1], target[2]);
      this.tray.localToWorld(this.world3);
      const snap = object.userData.needsSnap === true;
      if (snap) this.world3.y += (object.userData.spawnDrop as number) ?? 0;
      object.parent?.worldToLocal(this.world3);

      this.targetQuat.copy(this.trayQuat);
      if (entity.getValue(TaskTile, 'overflow')) {
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
