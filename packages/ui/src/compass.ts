import type { Params } from '@nh/core';
import { sheetShell, type OpenMenu } from './menu';

/** The pad rows, laid out like the directions around the hero; null is the Cancel button. */
export const COMPASS_ROWS: readonly (readonly (string | null)[])[] = [
  ['nw', 'n', 'ne'],
  ['w', null, 'e'],
  ['sw', 's', 'se'],
];
const ARROW: Record<string, string> = {
  nw: '↖',
  n: '↑',
  ne: '↗',
  w: '←',
  e: '→',
  sw: '↙',
  s: '↓',
  se: '↘',
};

/** Keys that pick a direction on the compass: vi keys (arrows go through the host's chord). */
export const COMPASS_KEYS: Record<string, string> = {
  h: 'w',
  j: 's',
  k: 'n',
  l: 'e',
  y: 'nw',
  u: 'ne',
  b: 'sw',
  n: 'se',
};

export interface CompassSpec {
  title: string;
  /** Directions the prompt offers; the others are disabled. */
  enabled: ReadonlySet<string>;
  cancelLabel: string;
  /** Aria labels per direction (optional). */
  dirLabels?: Record<string, string>;
  /** Other options (e.g. up/down) as plain buttons under the pad. */
  extras?: { label: string; run(): void }[];
  onPick(dir: string): void;
  onCancel(): void;
  onClose?: () => void;
}

/** A 3x3 direction pad as a bottom sheet. Cancel sits in the middle. */
export function openCompass(root: HTMLElement, spec: CompassSpec): OpenMenu {
  const doc = root.ownerDocument;
  const { overlay, sheet } = sheetShell(root, spec.title);
  const pad = doc.createElement('div');
  pad.className = 'nh-compass';
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    spec.onClose?.();
  };
  const pick = (dir: string): void => {
    if (closed || !spec.enabled.has(dir)) return;
    close();
    spec.onPick(dir);
  };
  const cancel = (): void => {
    if (closed) return;
    close();
    spec.onCancel();
  };
  for (const row of COMPASS_ROWS) {
    for (const dir of row) {
      const b = doc.createElement('button');
      b.type = 'button';
      if (dir === null) {
        b.className = 'nh-btn nh-dir nh-cancel';
        b.textContent = '✕';
        b.setAttribute('aria-label', spec.cancelLabel);
        b.addEventListener('click', cancel);
      } else {
        b.className = 'nh-btn nh-dir';
        b.dataset['dir'] = dir;
        b.textContent = ARROW[dir] ?? dir;
        const label = spec.dirLabels?.[dir];
        if (label) b.setAttribute('aria-label', label);
        b.disabled = !spec.enabled.has(dir);
        b.addEventListener('click', () => pick(dir));
      }
      pad.append(b);
    }
  }
  sheet.append(pad);
  for (const x of spec.extras ?? []) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'nh-btn nh-sheet-btn';
    b.textContent = x.label;
    b.addEventListener('click', () => {
      close();
      x.run();
    });
    sheet.append(b);
  }
  overlay.append(sheet);
  root.append(overlay);

  const onKey = (e: KeyboardEvent): boolean => {
    if (closed) return false;
    if (e.key === 'Escape') cancel();
    else {
      const dir = COMPASS_KEYS[e.key];
      if (dir) pick(dir);
    }
    return true;
  };
  return { el: overlay, close, onKey, getSel: () => 0, pickDir: pick };
}

export interface TextSpec {
  title: string;
  params?: Params;
  maxLength: number;
  okLabel: string;
  cancelLabel: string;
  /** Receives the trimmed text, capped at maxLength. */
  onSubmit(text: string): void;
  onCancel(): void;
  onClose?: () => void;
}

/** A text input sheet: Enter or OK submits, Escape or Cancel answers null. */
export function openTextPrompt(root: HTMLElement, spec: TextSpec): OpenMenu {
  const doc = root.ownerDocument;
  const { overlay, sheet } = sheetShell(root, spec.title);
  const input = doc.createElement('input');
  input.type = 'text';
  input.className = 'nh-text-input';
  input.maxLength = spec.maxLength;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('aria-label', spec.title);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    spec.onClose?.();
  };
  const submit = (): void => {
    if (closed) return;
    const text = input.value.trim().slice(0, spec.maxLength);
    close();
    spec.onSubmit(text);
  };
  const cancel = (): void => {
    if (closed) return;
    close();
    spec.onCancel();
  };
  const ok = doc.createElement('button');
  ok.type = 'button';
  ok.className = 'nh-btn nh-sheet-btn nh-confirm';
  ok.textContent = spec.okLabel;
  ok.addEventListener('click', submit);
  const no = doc.createElement('button');
  no.type = 'button';
  no.className = 'nh-btn nh-sheet-btn nh-cancel';
  no.textContent = spec.cancelLabel;
  no.addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    // Typing never reaches the game keys (attachKeys ignores inputs); these two are ours.
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  sheet.append(input, ok, no);
  overlay.append(sheet);
  root.append(overlay);
  input.focus();

  // Keys that reach the document while the input lost focus: refocus so typing still works.
  const onKey = (e: KeyboardEvent): boolean => {
    if (closed) return false;
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') cancel();
    else {
      input.focus();
      return false;
    }
    return true;
  };
  return { el: overlay, close, onKey, getSel: () => 0 };
}
