export const VISIBLE_LINES = 3;
export const MAX_HISTORY = 200;

export interface MessageLog {
  el: HTMLElement;
  push(text: string): void;
  lines(): readonly string[];
  setHistoryTitle(t: string): void;
}

export function createMessageLog(doc: Document): MessageLog {
  const el = doc.createElement('div');
  el.className = 'nh-log';
  const recent = doc.createElement('div');
  recent.className = 'nh-log-recent';
  const history = doc.createElement('div');
  history.className = 'nh-log-history';
  history.hidden = true;
  const title = doc.createElement('div');
  title.className = 'nh-log-title';
  const hist = doc.createElement('div');
  history.append(title, hist);
  el.append(recent, history);
  const lines: string[] = [];

  const render = (): void => {
    recent.replaceChildren();
    lines.slice(-VISIBLE_LINES).forEach((t, i, arr) => {
      const d = doc.createElement('div');
      d.className = i === arr.length - 1 ? 'nh-line nh-newest' : 'nh-line';
      d.textContent = t;
      recent.append(d);
    });
    hist.replaceChildren();
    for (const t of lines) {
      const d = doc.createElement('div');
      d.className = 'nh-line';
      d.textContent = t;
      hist.append(d);
    }
    history.scrollTop = history.scrollHeight;
  };
  el.addEventListener('click', () => {
    history.hidden = !history.hidden;
    el.classList.toggle('nh-expanded', !history.hidden);
    history.scrollTop = history.scrollHeight;
  });

  return {
    el,
    push(text) {
      lines.push(text);
      if (lines.length > MAX_HISTORY) lines.splice(0, lines.length - MAX_HISTORY);
      render();
    },
    lines: () => lines,
    setHistoryTitle(t) {
      title.textContent = t;
    },
  };
}
