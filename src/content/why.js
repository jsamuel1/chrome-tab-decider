// Makes room for the "Why?" card in a page, only after the user moves its tab by hand. The card
// itself is an extension page (why.html) in a frame: the page can neither read it nor see what is
// clicked or typed in it, as key and pointer events inside a frame from another origin never reach
// the page, and they leave the page's own keyboard shortcuts alone. The page sees only an empty box,
// in a closed shadow root. The frame tells this script nothing but when to go and how tall to be.

const FRAME = chrome.runtime.getURL('why.html');
const ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');

const CSS = `
:host { all: initial; }
iframe {
  display: block; width: 300px; height: 180px; border: 0; border-radius: 12px; background: transparent;
  box-shadow: 0 8px 28px rgba(0,0,0,.18); color-scheme: normal;
}
`;

let close = () => {};

function show() {
  close();
  const host = document.createElement('tabsage-why');
  // inline !important so page styles cannot hide or move the card's host element
  for (const [k, v] of Object.entries({ all: 'initial', position: 'fixed', right: '16px', bottom: '16px', 'z-index': '2147483647' })) {
    host.style.setProperty(k, v, 'important');
  }
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const frame = document.createElement('iframe');
  frame.setAttribute('src', FRAME);
  frame.setAttribute('title', 'TabSage');

  const onMessage = (e) => {
    // only the card's own frame; anyone else posting to this window is ignored
    if (e.source !== frame.contentWindow || e.origin !== ORIGIN) return;
    const m = e.data || {};
    if (m.tabsageWhy === 'close') done();
    else if (m.tabsageWhy === 'size') frame.style.height = `${Math.min(420, Math.max(60, Number(m.height) || 0))}px`;
  };
  const done = () => {
    window.removeEventListener('message', onMessage);
    host.remove();
    close = () => {};
  };
  window.addEventListener('message', onMessage);
  root.append(style, frame);
  document.documentElement.append(host);
  close = done;
}

// Injected again on every move: listen only once.
if (!globalThis.__tabsageWhy) {
  globalThis.__tabsageWhy = true;
  chrome.runtime.onMessage.addListener((msg, sender) => {
    // only the extension's own service worker: not other extensions, not other tabs
    if (sender.id !== chrome.runtime.id || sender.tab || msg?.target !== 'why') return;
    if (msg.close) close(); // the tab was moved again: that question no longer stands
    else if (msg.show) show();
  });
}
