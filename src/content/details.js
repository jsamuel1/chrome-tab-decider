// Content script: reports a few page details to the background, once on load and once more
// if the title changes within 5 seconds (single-page apps set it late).
import { extractDetails } from './extract.js';

let last = '';
function report() {
  const details = extractDetails(document);
  const key = JSON.stringify(details);
  if (key === last) return;
  last = key;
  try {
    chrome.runtime.sendMessage({ target: 'background', type: 'pageDetails', url: location.href, details }).catch(() => {});
  } catch {}
}

report();
const firstTitle = document.title;
const timer = setTimeout(() => obs.disconnect(), 5000);
const obs = new MutationObserver(() => {
  if (document.title === firstTitle) return;
  clearTimeout(timer);
  obs.disconnect();
  report();
});
const titleEl = document.querySelector('title');
if (titleEl) obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
else obs.disconnect();
