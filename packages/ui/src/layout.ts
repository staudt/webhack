export interface Layout {
  log: HTMLElement;
  map: HTMLElement;
  bar: HTMLElement;
  menuBtn: HTMLButtonElement;
  actionsBtn: HTMLButtonElement;
  lookBtn: HTMLButtonElement;
}

export function buildLayout(root: HTMLElement, log: HTMLElement): Layout {
  const doc = root.ownerDocument;
  root.classList.add('nh-ui');
  const map = doc.createElement('div');
  map.className = 'nh-map';
  const bar = doc.createElement('div');
  bar.className = 'nh-bar';
  const mk = (cls: string): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `nh-btn ${cls}`;
    return b;
  };
  const menuBtn = mk('nh-menu-btn');
  const actionsBtn = mk('nh-actions-btn');
  const lookBtn = mk('nh-look-btn');
  lookBtn.setAttribute('aria-pressed', 'false');
  bar.append(menuBtn, actionsBtn, lookBtn);
  root.append(log, map, bar);
  return { log, map, bar, menuBtn, actionsBtn, lookBtn };
}
