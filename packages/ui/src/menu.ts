export interface MenuEntry {
  label: string;
  run(): void;
}

export interface MenuSpec {
  title: string;
  entries: MenuEntry[];
  /** Cancel button label; omit for a non-dismissable modal (prompts). */
  cancelLabel?: string;
  onClose?: () => void;
}

export interface OpenMenu {
  el: HTMLElement;
  close(): void;
  /** Returns true if the key was consumed (all keys are while a modal is open). */
  onKey(e: KeyboardEvent): boolean;
}

export function openMenu(root: HTMLElement, spec: MenuSpec): OpenMenu {
  const doc = root.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.className = 'nh-modal';
  const sheet = doc.createElement('div');
  sheet.className = 'nh-sheet';
  sheet.setAttribute('role', 'dialog');
  const h = doc.createElement('div');
  h.className = 'nh-sheet-title';
  h.textContent = spec.title;
  sheet.append(h);

  const buttons: HTMLButtonElement[] = [];
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    spec.onClose?.();
  };
  const addBtn = (label: string, fn: () => void, cls = ''): void => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `nh-btn nh-sheet-btn ${cls}`.trim();
    b.textContent = label;
    b.addEventListener('click', fn);
    buttons.push(b);
    sheet.append(b);
  };
  for (const en of spec.entries) {
    addBtn(en.label, () => {
      close();
      en.run();
    });
  }
  if (spec.cancelLabel !== undefined) addBtn(spec.cancelLabel, close, 'nh-cancel');

  let sel = 0;
  const mark = (): void => {
    buttons.forEach((b, i) => b.classList.toggle('nh-sel', i === sel));
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
  return { el: overlay, close, onKey };
}
