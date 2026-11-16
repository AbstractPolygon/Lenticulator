/** Top-bar popup menus and per-device preferences (theme, panel location). */

/** A value remembered in this browser (silently skipped when storage is unavailable). */
export function pref(key: string, fallback: string) {
  const k = `lenticulator.${key}`;
  let value = fallback;
  try { value = localStorage.getItem(k) || fallback; } catch { /* storage unavailable */ }
  return {
    value,
    set(v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
}

/** Wire a select to a remembered preference; `apply` runs now and on every change. */
export function bindPref(select: HTMLSelectElement, key: string, fallback: string, apply: (v: string) => void) {
  const p = pref(key, fallback);
  const run = (v: string) => { select.value = v; apply(v); };
  run(p.value);
  select.addEventListener('change', () => { p.set(select.value); run(select.value); });
}

/** Toggle a popup panel from its button; closes on outside click or Escape. Returns setOpen. */
export function bindMenu(btn: HTMLElement, panel: HTMLElement) {
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLElement>('select, input, button')?.focus();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden !== false); });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
  });
  return setOpen;
}
