// The "Why?" card, an extension page shown in a frame in the page whose tab the user just moved.
// It asks the service worker for its question and sends back the answer itself; the page around it
// is only told when to remove the frame and how tall it is. It never blocks the page: left alone, it
// goes away and the move still counts.

import { bg } from '../lib/ui-common.js';

const DISMISS_MS = 8000;
const $ = (id) => document.getElementById(id);
// the page learns nothing from these but that the card is done, or how tall it is
const tell = (m) => window.parent.postMessage(m, '*');

let timer = 0;
const card = document.querySelector('.card');
const input = $('text');

const done = () => {
  clearTimeout(timer);
  tell({ tabsageWhy: 'close' });
};
const send = async (optionId) => {
  try {
    await bg('saveReason', { optionId, text: input.value });
  } catch {} // the extension was reloaded since the card appeared
  done();
};
const wait = () => {
  clearTimeout(timer);
  timer = setTimeout(done, DISMISS_MS);
};
const idle = () => !input.value.trim() && document.activeElement !== input;

async function start() {
  let ask = null;
  try {
    ask = await bg('whyQuestion');
  } catch {}
  if (!ask) return done();
  $('q').textContent = String(ask.question ?? '');
  for (const o of Array.isArray(ask.options) ? ask.options : []) {
    const b = document.createElement('button');
    b.className = 'a';
    b.type = 'button';
    b.textContent = String(o?.label ?? '');
    b.addEventListener('click', () => send(String(o?.id ?? '')));
    $('answers').append(b);
  }
  card.hidden = false;
  tell({ tabsageWhy: 'size', height: Math.ceil(card.getBoundingClientRect().height) });
  wait();
}

$('x').addEventListener('click', done);
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim()) send('text');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
// touched: it stays until answered or dismissed; left alone again with nothing typed, it goes
card.addEventListener('pointerenter', () => clearTimeout(timer));
card.addEventListener('focusin', () => clearTimeout(timer));
card.addEventListener('pointerleave', () => { if (idle()) wait(); });
card.addEventListener('focusout', () => setTimeout(() => { if (idle() && !card.matches(':hover')) wait(); }));

start();
