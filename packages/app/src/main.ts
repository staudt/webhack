export function mount(root: HTMLElement | null): void {
  if (root) root.textContent = 'webhack';
}

if (typeof document !== 'undefined') mount(document.getElementById('app'));
