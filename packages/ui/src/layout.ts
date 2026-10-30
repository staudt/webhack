export interface Layout {
  log: HTMLElement;
  map: HTMLElement;
  status: HTMLElement;
  bar: HTMLElement;
  menuBtn: HTMLButtonElement;
  actionsBtn: HTMLButtonElement;
  lookBtn: HTMLButtonElement;
  inventoryBtn: HTMLButtonElement;
}

export function buildLayout(root: HTMLElement, log: HTMLElement): Layout {
  const doc = root.ownerDocument;
  root.classList.add('nh-ui');
  const map = doc.createElement('div');
  map.className = 'nh-map';
  const status = doc.createElement('div');
  status.className = 'nh-status';
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
  const inventoryBtn = mk('nh-inventory-btn');
  lookBtn.setAttribute('aria-pressed', 'false');
  bar.append(menuBtn, actionsBtn, inventoryBtn, lookBtn);
  root.append(log, map, status, bar);
  return { log, map, status, bar, menuBtn, actionsBtn, lookBtn, inventoryBtn };
}
