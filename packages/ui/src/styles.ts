export const STYLE_ID = 'nh-ui-style';

export const css = `
.nh-ui{--nh-bg:#0d0f12;--nh-panel:#171a20;--nh-fg:#d8dde6;--nh-dim:#8a93a3;--nh-accent:#4da3ff;--nh-border:#2a2f3a;
position:relative;display:flex;flex-direction:column;width:100%;height:100dvh;box-sizing:border-box;overflow:hidden;
background:var(--nh-bg);color:var(--nh-fg);font-family:system-ui,sans-serif;
padding-top:env(safe-area-inset-top);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom)}
.nh-log{position:relative;flex:none;background:var(--nh-panel);border-bottom:1px solid var(--nh-border);padding:4px 8px;min-height:3.6em;cursor:pointer;font-size:14px;line-height:1.2}
.nh-line{white-space:pre-wrap;color:var(--nh-dim)}
.nh-newest{color:var(--nh-fg);font-weight:bold}
.nh-log-history{position:absolute;left:0;right:0;top:0;max-height:60dvh;overflow-y:auto;background:var(--nh-panel);border-bottom:2px solid var(--nh-accent);padding:4px 8px;z-index:5}
.nh-log-title{font-weight:bold;color:var(--nh-accent)}
.nh-map{flex:1;min-height:0;position:relative;overflow:hidden;touch-action:none}
.nh-bar{flex:none;display:flex;gap:8px;padding:8px;background:var(--nh-panel);border-top:1px solid var(--nh-border)}
.nh-btn{min-width:44px;min-height:44px;padding:8px 14px;font-size:16px;color:var(--nh-fg);background:#232833;border:1px solid var(--nh-border);border-radius:8px;cursor:pointer}
.nh-bar .nh-btn{flex:1}
.nh-btn[aria-pressed="true"],.nh-sel{background:var(--nh-accent);color:#000}
.nh-modal{position:absolute;inset:0;z-index:10;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center}
.nh-sheet{width:100%;max-width:480px;max-height:80dvh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--nh-panel);border-radius:12px 12px 0 0}
.nh-sheet-title{font-weight:bold;padding:4px}
.nh-sheet-btn{text-align:left}
`;

export function injectStyles(doc: Document): HTMLStyleElement {
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = css;
  doc.head.append(s);
  return s;
}
