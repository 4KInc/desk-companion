/**
 * 2D-page brain dump box. On Quest this is typed with the system keyboard in the
 * browser before entering XR; on desktop it is the fastest way to add tasks.
 * Hidden while an immersive session is presenting.
 */
export interface CalendarActions {
  connect(source: string): Promise<string>;
  disconnect(): void;
  connected(): { url: string; sample: boolean };
  /** Called when the app changes the connection itself (the first-visit sample day). */
  onChange?(listener: () => void): void;
}

/** A realistic morning, so a first-time visitor can try the agent without typing. */
const EXAMPLE_DUMP =
  "Finish the Q4 roadmap doc, review Sam's pull request before noon, 1:1 with Alex, prep slides for Thursday's demo, reply to the recruiter, book flights to Berlin, maybe tidy up the backlog";

export interface DraftView {
  id: number;
  kind: string;
  title: string;
  body: string;
  nextStep: string;
}

export interface DraftActions {
  list(): DraftView[];
  onChange(listener: (drafts: DraftView[]) => void): void;
}

export function mountBrainDumpOverlay(
  onSubmit: (text: string) => Promise<number>,
  calendar?: CalendarActions,
  drafts?: DraftActions,
): HTMLElement {
  const card = document.createElement('form');
  card.id = 'brain-dump';
  card.style.cssText =
    'position:fixed;left:20px;bottom:20px;width:320px;padding:14px 16px;border-radius:16px;' +
    'background:#fbfcfe;color:#1f2328;font:14px/1.4 system-ui,sans-serif;' +
    'box-shadow:0 8px 28px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px;z-index:10;' +
    'max-height:calc(100vh - 40px);overflow-y:auto;box-sizing:border-box';
  card.innerHTML = `
    <strong style="font-size:17px">Brain dump</strong>
    <textarea id="brain-dump-text" rows="5" placeholder="What's on your mind today? One thing per line, or just write it out."
      style="resize:vertical;border:1px solid #cfd6df;border-radius:10px;padding:8px;font:inherit"></textarea>
    <button id="brain-dump-submit" type="submit"
      style="border:0;border-radius:999px;padding:10px;background:#1f2328;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer">
      Make tiles</button>
    <div style="display:flex;align-items:center;gap:8px">
      <span id="brain-dump-hint" style="flex:1;color:#5b616b;font-size:12px">The agent splits and estimates it. Works offline too.</span>
      <button id="brain-dump-example" type="button"
        style="border:1px solid #5b6576;border-radius:999px;padding:6px 10px;background:#fff;color:#5b6576;font:600 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap">Use an example</button>
    </div>
    <div style="border-top:1px solid #e1e5ea;margin-top:4px;padding-top:8px;display:flex;flex-direction:column;gap:6px">
      <strong style="font-size:15px">Today's meetings</strong>
      <input id="calendar-url" type="url" placeholder="Private iCal link (Google, Outlook, iCloud...)"
        style="border:1px solid #cfd6df;border-radius:10px;padding:8px;font:inherit" />
      <div style="display:flex;gap:6px">
        <button id="calendar-connect" type="button"
          style="flex:1;border:0;border-radius:999px;padding:8px;background:#5b6576;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer">Connect</button>
        <button id="calendar-sample" type="button"
          style="flex:1;border:1px solid #5b6576;border-radius:999px;padding:8px;background:#fff;color:#5b6576;font:600 13px system-ui,sans-serif;cursor:pointer">Try a sample day</button>
      </div>
      <span id="calendar-status" style="color:#5b616b;font-size:12px">Meetings appear as fixed blocks in Now. The link stays on this device.</span>
    </div>
    <div id="drafts" style="border-top:1px solid #e1e5ea;margin-top:4px;padding-top:8px;display:none;flex-direction:column;gap:6px;max-height:220px;overflow:auto">
      <strong style="font-size:15px">Drafts from the agent</strong>
      <div id="drafts-list" style="display:flex;flex-direction:column;gap:8px"></div>
    </div>`;
  const text = card.querySelector<HTMLTextAreaElement>('#brain-dump-text')!;
  const submit = card.querySelector<HTMLButtonElement>('#brain-dump-submit')!;
  const hint = card.querySelector<HTMLSpanElement>('#brain-dump-hint')!;
  card.querySelector<HTMLButtonElement>('#brain-dump-example')!.addEventListener('click', () => {
    text.value = EXAMPLE_DUMP;
    text.focus();
    hint.textContent = 'An example morning. Edit it, or tap Make tiles.';
  });
  card.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!text.value.trim()) return;
    submit.disabled = true;
    submit.textContent = 'Sorting...';
    try {
      const count = await onSubmit(text.value);
      if (count > 0) text.value = '';
      hint.textContent = count > 0 ? `${count} tiles are on your tray.` : 'No tasks found. Try one per line.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Make tiles';
    }
  });
  if (calendar) wireCalendar(card, calendar);
  if (drafts) wireDrafts(card, drafts);
  document.body.appendChild(card);
  return card;
}

function wireCalendar(card: HTMLElement, calendar: CalendarActions): void {
  const input = card.querySelector<HTMLInputElement>('#calendar-url')!;
  const connect = card.querySelector<HTMLButtonElement>('#calendar-connect')!;
  const sample = card.querySelector<HTMLButtonElement>('#calendar-sample')!;
  const status = card.querySelector<HTMLSpanElement>('#calendar-status')!;
  const showConnected = () => {
    const current = calendar.connected();
    const on = current.sample || current.url !== '';
    connect.textContent = on ? 'Disconnect' : 'Connect';
    if (current.url) input.value = current.url;
  };
  const run = async (source: string, button: HTMLButtonElement) => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Reading...';
    try {
      status.textContent = await calendar.connect(source);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not read that calendar';
    } finally {
      button.disabled = false;
      button.textContent = label;
      showConnected();
    }
  };
  connect.addEventListener('click', () => {
    const current = calendar.connected();
    if (current.sample || current.url) {
      calendar.disconnect();
      input.value = '';
      status.textContent = 'Calendar disconnected.';
      showConnected();
      return;
    }
    if (!input.value.trim()) {
      status.textContent = 'Paste your private iCal link first, or try the sample day.';
      return;
    }
    void run(input.value, connect);
  });
  sample.addEventListener('click', () => void run('sample', sample));
  // Saved state loads asynchronously; reflect it once it is there.
  calendar.onChange?.(() => {
    showConnected();
    if (calendar.connected().sample) {
      status.textContent = 'Showing a sample day. Paste your own iCal link and Connect to replace it.';
    }
  });
  setTimeout(showConnected, 1500);
}

/** Latest drafts with a Copy button: how a draft leaves the app and becomes a real email or doc. */
function wireDrafts(card: HTMLElement, drafts: DraftActions): void {
  const section = card.querySelector<HTMLDivElement>('#drafts')!;
  const list = card.querySelector<HTMLDivElement>('#drafts-list')!;
  const render = (items: DraftView[]) => {
    section.style.display = items.length > 0 ? 'flex' : 'none';
    list.replaceChildren(
      ...items.slice(-5).reverse().map((draft, index) => {
        const item = document.createElement('div');
        item.style.cssText = 'border:1px solid #e1e5ea;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:4px';
        const title = document.createElement('strong');
        title.style.fontSize = '13px';
        title.textContent = draft.title;
        const body = document.createElement('div');
        body.style.cssText = 'white-space:pre-wrap;font-size:12px;color:#3d434b;max-height:72px;overflow:hidden';
        body.textContent = draft.body;
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy';
        copy.setAttribute('aria-label', `Copy draft: ${draft.title}`);
        copy.dataset.testid = `draft-copy-${index}`;
        copy.style.cssText = 'align-self:flex-start;border:0;border-radius:999px;padding:5px 12px;background:#2fb5a8;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(`${draft.body}\n\nNext: ${draft.nextStep}`);
            copy.textContent = 'Copied';
          } catch {
            copy.textContent = 'Select and copy the text';
          }
        });
        item.append(title, body, copy);
        return item;
      }),
    );
  };
  drafts.onChange(render);
  render(drafts.list());
}
