/**
 * 2D-page brain dump box. On Quest this is typed with the system keyboard in the
 * browser before entering XR; on desktop it is the fastest way to add tasks.
 * Hidden while an immersive session is presenting.
 */
export function mountBrainDumpOverlay(onSubmit: (text: string) => Promise<number>): HTMLElement {
  const card = document.createElement('form');
  card.id = 'brain-dump';
  card.style.cssText =
    'position:fixed;left:20px;bottom:20px;width:320px;padding:14px 16px;border-radius:16px;' +
    'background:#fbfcfe;color:#1f2328;font:14px/1.4 system-ui,sans-serif;' +
    'box-shadow:0 8px 28px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px;z-index:10';
  card.innerHTML = `
    <strong style="font-size:17px">Brain dump</strong>
    <textarea id="brain-dump-text" rows="5" placeholder="What's on your mind today? One thing per line, or just write it out."
      style="resize:vertical;border:1px solid #cfd6df;border-radius:10px;padding:8px;font:inherit"></textarea>
    <button id="brain-dump-submit" type="submit"
      style="border:0;border-radius:999px;padding:10px;background:#1f2328;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer">
      Make tiles</button>
    <span id="brain-dump-hint" style="color:#5b616b;font-size:12px">The agent splits and estimates it. Works offline too.</span>`;
  const text = card.querySelector<HTMLTextAreaElement>('#brain-dump-text')!;
  const submit = card.querySelector<HTMLButtonElement>('#brain-dump-submit')!;
  const hint = card.querySelector<HTMLSpanElement>('#brain-dump-hint')!;
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
  document.body.appendChild(card);
  return card;
}
