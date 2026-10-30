import type { Glyph } from '@nh/core';

export interface MenuEntry {
  label: string;
  run(): void;
  /** Drawn before the label in the glyph's colour. */
  glyph?: Glyph;
  /** A non-selectable section heading. */
  heading?: boolean;
  /** Non-selectable plain text line. */
  text?: boolean;
}

export interface MenuSpec {
  title: string;
  entries: MenuEntry[];
  /** Cancel button label; omit for a non-dismissable modal (prompts). */
  cancelLabel?: string;
  /** Initially highlighted button (among the selectable ones). */
  sel?: number;
  onClose?: () => void;
}

export interface OpenMenu {
  el: HTMLElement;
  close(): void;
  /** Returns true if the key was consumed (all keys are while a modal is open). */
  onKey(e: KeyboardEvent): boolean;
  /** Currently highlighted button index. */
  getSel(): number;
  /** Compass sheets only: choose a direction (used by the host for arrow-key chords). */
  pickDir?(dir: string): void;
}

function glyphSpan(doc: Document, g: Glyph): HTMLSpanElement {
  const s = doc.createElement('span');
  s.className = 'nh-glyph';
  s.textContent = g.ch;
  s.style.color = g.fg;
  return s;
}

export function sheetShell(
  root: HTMLElement,
  title: string,
): { overlay: HTMLElement; sheet: HTMLElement } {
  const doc = root.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.className = 'nh-modal';
  const sheet = doc.createElement('div');
  sheet.className = 'nh-sheet';
  sheet.setAttribute('role', 'dialog');
  const h = doc.createElement('div');
  h.className = 'nh-sheet-title';
  h.textContent = title;
  sheet.append(h);
  return { overlay, sheet };
}

export function openMenu(root: HTMLElement, spec: MenuSpec): OpenMenu {
  const doc = root.ownerDocument;
  const { overlay, sheet } = sheetShell(root, spec.title);

  const buttons: HTMLButtonElement[] = [];
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    spec.onClose?.();
  };
  const addBtn = (label: string, fn: () => void, cls = '', glyph?: Glyph): void => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `nh-btn nh-sheet-btn ${cls}`.trim();
    if (glyph) b.append(glyphSpan(doc, glyph), ' ');
    b.append(label);
    b.addEventListener('click', fn);
    buttons.push(b);
    sheet.append(b);
  };
  for (const en of spec.entries) {
    if (en.heading || en.text) {
      const d = doc.createElement('div');
      d.className = en.heading ? 'nh-sheet-heading' : 'nh-sheet-text';
      d.textContent = en.label;
      sheet.append(d);
      continue;
    }
    addBtn(
      en.label,
      () => {
        close();
        en.run();
      },
      '',
      en.glyph,
    );
  }
  if (spec.cancelLabel !== undefined) addBtn(spec.cancelLabel, close, 'nh-cancel');

  let sel = Math.min(Math.max(0, spec.sel ?? 0), Math.max(0, buttons.length - 1));
  const mark = (): void => {
    buttons.forEach((b, i) => b.classList.toggle('nh-sel', i === sel));
    buttons[sel]?.scrollIntoView?.({ block: 'nearest' });
  };
  mark();
  overlay.append(sheet);
  root.append(overlay);

  const onKey = (e: KeyboardEvent): boolean => {
    if (closed) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight')
      sel = (sel + 1) % Math.max(1, buttons.length);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
      sel = (sel - 1 + buttons.length) % Math.max(1, buttons.length);
    else if (e.key === 'Enter') buttons[sel]?.click();
    else if (e.key === 'Escape' && spec.cancelLabel !== undefined) close();
    mark();
    return true;
  };
  return { el: overlay, close, onKey, getSel: () => sel };
}

export interface ChecklistOption {
  label: string;
  glyph?: Glyph;
  /** A count from 1 to `max` may be chosen (a stack size). */
  max?: number;
}

export interface ChecklistChoice {
  index: number;
  /** The chosen count; max when the whole stack is taken (or the option has no max). */
  count: number;
}

export interface ChecklistSpec {
  title: string;
  options: ChecklistOption[];
  confirmLabel: string;
  cancelLabel: string;
  lessLabel?: string;
  moreLabel?: string;
  /** Chosen options, ascending by index. */
  onConfirm(chosen: ChecklistChoice[]): void;
  onCancel(): void;
  onClose?: () => void;
}

/**
 * A multi-select sheet: toggle rows, then Confirm or Cancel. Options with `max > 1` get a count
 * stepper (default max); typing digits before a row's letter sets its count ("3a").
 */
export function openChecklist(root: HTMLElement, spec: ChecklistSpec): OpenMenu {
  const doc = root.ownerDocument;
  const { overlay, sheet } = sheetShell(root, spec.title);
  const rows: HTMLButtonElement[] = [];
  const checked: boolean[] = spec.options.map(() => false);
  const maxOf = (i: number): number => spec.options[i]?.max ?? 1;
  const counts: number[] = spec.options.map((o) => Math.max(1, o.max ?? 1));
  const countEls: (HTMLElement | null)[] = spec.options.map(() => null);
  let typed = '';
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    spec.onClose?.();
  };
  const finish = (ok: boolean): void => {
    const chosen = checked.flatMap((c, i) => (c ? [{ index: i, count: counts[i] ?? 1 }] : []));
    close();
    if (ok) spec.onConfirm(chosen);
    else spec.onCancel();
  };
  let sel = 0;
  const mark = (): void => {
    rows.forEach((b, i) => {
      b.classList.toggle('nh-sel', i === sel);
      b.classList.toggle('nh-checked', checked[i] === true);
      b.setAttribute('aria-checked', String(checked[i] === true));
      const el = countEls[i];
      if (el) el.textContent = String(counts[i]);
    });
    rows[sel]?.scrollIntoView?.({ block: 'nearest' });
  };
  const toggle = (i: number): void => {
    if (i < 0 || i >= checked.length) return;
    const n = Number(typed);
    typed = '';
    if (maxOf(i) > 1 && n > 0) {
      // "3a": that many of a, and selected.
      counts[i] = Math.min(n, maxOf(i));
      checked[i] = true;
    } else checked[i] = !checked[i];
    sel = i;
    mark();
  };
  const step = (i: number, d: number): void => {
    counts[i] = Math.min(maxOf(i), Math.max(1, (counts[i] ?? 1) + d));
    checked[i] = true;
    sel = i;
    mark();
  };
  const stepper = (i: number, label: string, text: string, d: number): HTMLElement => {
    const b = doc.createElement('span');
    b.className = 'nh-step';
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', label);
    b.tabIndex = 0;
    b.textContent = text;
    b.addEventListener('click', () => step(i, d));
    return b;
  };
  spec.options.forEach((o, i) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'nh-btn nh-sheet-btn nh-check';
    b.setAttribute('role', 'checkbox');
    const letter = i < 26 ? String.fromCharCode(97 + i) : ' ';
    const box = doc.createElement('span');
    box.className = 'nh-checkbox';
    b.append(`${letter} `, box, ' ');
    if (o.glyph) b.append(glyphSpan(doc, o.glyph), ' ');
    b.append(o.label);
    b.addEventListener('click', () => toggle(i));
    rows.push(b);
    if (maxOf(i) > 1) {
      const wrap = doc.createElement('div');
      wrap.className = 'nh-check-row';
      const num = doc.createElement('span');
      num.className = 'nh-count';
      countEls[i] = num;
      wrap.append(
        b,
        stepper(i, spec.lessLabel ?? 'Fewer', '−', -1),
        num,
        stepper(i, spec.moreLabel ?? 'More', '+', 1),
      );
      sheet.append(wrap);
    } else sheet.append(b);
  });
  const confirm = doc.createElement('button');
  confirm.type = 'button';
  confirm.className = 'nh-btn nh-sheet-btn nh-confirm';
  confirm.textContent = spec.confirmLabel;
  confirm.addEventListener('click', () => finish(true));
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'nh-btn nh-sheet-btn nh-cancel';
  cancel.textContent = spec.cancelLabel;
  cancel.addEventListener('click', () => finish(false));
  sheet.append(confirm, cancel);
  mark();
  overlay.append(sheet);
  root.append(overlay);

  const onKey = (e: KeyboardEvent): boolean => {
    if (closed) return false;
    const n = Math.max(1, rows.length);
    if (/^[0-9]$/.test(e.key)) {
      typed = (typed + e.key).slice(0, 4);
      return true;
    }
    const digits = typed;
    typed = '';
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') sel = (sel + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') sel = (sel - 1 + n) % n;
    else if (e.key === ' ') {
      typed = digits;
      toggle(sel);
    } else if (e.key === 'Enter') {
      finish(true);
      return true;
    } else if (e.key === 'Escape') {
      finish(false);
      return true;
    } else if (/^[a-z]$/.test(e.key)) {
      typed = digits;
      toggle(e.key.charCodeAt(0) - 97);
    }
    mark();
    return true;
  };
  return { el: overlay, close, onKey, getSel: () => sel };
}
