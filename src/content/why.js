// The "Why?" card, injected into a page only after the user moves its tab by hand. It lives in a
// closed shadow root, so the page can neither read nor restyle it, and its text is set with
// textContent only. It never blocks the page: left alone, it goes away and the move still counts.

const DISMISS_MS = 8000;

const CSS = `
:host { all: initial; }
.card {
  box-sizing: border-box; width: 300px; padding: 12px; border-radius: 12px;
  background: #fff; color: #1d2330; border: 1px solid #e6e8ec; box-shadow: 0 8px 28px rgba(0,0,0,.18);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.top { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
.q { flex: 1; font-weight: 600; }
.x { border: 0; background: none; color: #6b7280; padding: 0 4px; font-size: 16px; line-height: 1; cursor: pointer; }
.answers { display: flex; flex-direction: column; gap: 6px; }
button.a {
  text-align: left; font: inherit; color: inherit; background: #fff; cursor: pointer;
  border: 1px solid #e6e8ec; border-radius: 8px; padding: 6px 10px;
}
button.a:hover { background: #f2f4f7; }
input {
  box-sizing: border-box; width: 100%; margin-top: 8px; padding: 6px 10px; font: inherit; color: inherit;
  background: #fff; border: 1px solid #e6e8ec; border-radius: 8px;
}
button:focus-visible, input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }
.brand { margin-top: 6px; color: #6b7280; font-size: 11px; }
@media (prefers-color-scheme: dark) {
  .card, button.a, input { background: #1b1e24; color: #e8eaf0; border-color: #2d323c; }
  button.a:hover { background: #262a33; }
  .x, .brand { color: #9aa3b2; }
  button:focus-visible, input:focus { outline-color: #7aa2ff; }
}
`;

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

let close = () => {};

function show({ question, options }) {
  close();
  const host = document.createElement('tabsage-why');
  // inline !important so page styles cannot hide or move the card's host element
  for (const [k, v] of Object.entries({ all: 'initial', position: 'fixed', right: '16px', bottom: '16px', 'z-index': '2147483647' })) {
    host.style.setProperty(k, v, 'important');
  }
  const root = host.attachShadow({ mode: 'closed' });

  let timer = 0;
  const input = el('input', { type: 'text', maxlength: '200', placeholder: 'Or say why in your own words', 'aria-label': 'Why, in your own words' });
  const done = () => {
    clearTimeout(timer);
    host.remove();
    close = () => {};
  };
  const send = (optionId) => {
    try {
      chrome.runtime.sendMessage({ target: 'background', type: 'saveReason', optionId, text: input.value }).catch(() => {});
    } catch {} // the extension was reloaded since the card appeared
    done();
  };
  const wait = () => {
    clearTimeout(timer);
    timer = setTimeout(done, DISMISS_MS);
  };
  const idle = () => !input.value.trim() && root.activeElement !== input;

  const dismiss = el('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', text: '×' });
  dismiss.addEventListener('click', done);
  const answers = el('div', { class: 'answers' });
  for (const o of Array.isArray(options) ? options : []) {
    const b = el('button', { class: 'a', type: 'button', text: String(o?.label ?? '') });
    b.addEventListener('click', () => send(String(o?.id ?? '')));
    answers.append(b);
  }
  const form = el('form', {}, input);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) send('text');
  });

  const card = el('div', { class: 'card', role: 'dialog', 'aria-label': 'TabSage' },
    el('div', { class: 'top' }, el('div', { class: 'q', text: String(question ?? '') }), dismiss),
    answers, form, el('div', { class: 'brand', text: 'TabSage' }));
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
  // touched: it stays until answered or dismissed; left alone again with nothing typed, it goes
  card.addEventListener('pointerenter', () => clearTimeout(timer));
  card.addEventListener('focusin', () => clearTimeout(timer));
  card.addEventListener('pointerleave', () => { if (idle()) wait(); });
  card.addEventListener('focusout', () => setTimeout(() => { if (idle() && !card.matches(':hover')) wait(); }));

  root.append(el('style', { text: CSS }), card);
  document.documentElement.append(host);
  close = done;
  wait();
}

// Injected again on every move: listen only once.
if (!globalThis.__tabsageWhy) {
  globalThis.__tabsageWhy = true;
  chrome.runtime.onMessage.addListener((msg, sender) => {
    // only the extension's own service worker: not other extensions, not other tabs
    if (sender.id !== chrome.runtime.id || sender.tab || msg?.target !== 'why') return;
    if (msg.close) close(); // the tab was moved again: that question no longer stands
    else show(msg);
  });
}
