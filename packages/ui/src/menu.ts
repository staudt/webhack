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
}

function glyphSpan(doc: Document, g: Glyph): HTMLSpanElement {
  const s = doc.createElement('span');
  s.className = 'nh-glyph';
  s.textContent = g.ch;
  s.style.color = g.fg;
  return s;
}

function sheetShell(
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
}

export interface ChecklistSpec {
  title: string;
  options: ChecklistOption[];
  confirmLabel: string;
  cancelLabel: string;
  /** Chosen option indices, ascending. */
  onConfirm(chosen: number[]): void;
  onCancel(): void;
  onClose?: () => void;
}

/** A multi-select sheet: toggle rows, then Confirm or Cancel. */
export function openChecklist(root: HTMLElement, spec: ChecklistSpec): OpenMenu {
  const doc = root.ownerDocument;
  const { overlay, sheet } = sheetShell(root, spec.title);
  const rows: HTMLButtonElement[] = [];
  const checked: boolean[] = spec.options.map(() => false);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    spec.onClose?.();
  };
  const finish = (ok: boolean): void => {
    const chosen = checked.flatMap((c, i) => (c ? [i] : []));
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
    });
    rows[sel]?.scrollIntoView?.({ block: 'nearest' });
  };
  const toggle = (i: number): void => {
    if (i < 0 || i >= checked.length) return;
    checked[i] = !checked[i];
    sel = i;
    mark();
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
    sheet.append(b);
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') sel = (sel + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') sel = (sel - 1 + n) % n;
    else if (e.key === ' ') toggle(sel);
    else if (e.key === 'Enter') {
      finish(true);
      return true;
    } else if (e.key === 'Escape') {
      finish(false);
      return true;
    } else if (/^[a-z]$/.test(e.key)) toggle(e.key.charCodeAt(0) - 97);
    mark();
    return true;
  };
  return { el: overlay, close, onKey, getSel: () => sel };
}
