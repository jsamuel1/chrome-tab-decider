// Lazy placeholder: shows the saved title/favicon and only loads the real page when you look at it.
const p = new URLSearchParams(location.hash.slice(1));
const url = p.get('u') || '';
const title = p.get('t') || url;

document.title = title;
document.getElementById('title').textContent = title;
document.getElementById('url').textContent = url;

// Chrome's favicon cache (needs the "favicon" permission) — works offline and for any site you've visited.
const fav = new URL(chrome.runtime.getURL('/_favicon/'));
fav.searchParams.set('pageUrl', url);
fav.searchParams.set('size', '32');
document.getElementById('fav').href = fav.toString();
document.getElementById('icon').src = fav.toString();

let going = false;
function go() {
  if (going || !/^(https?|file):/i.test(url)) return;
  going = true;
  location.replace(url);
}
document.getElementById('card').addEventListener('click', go);
document.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && go());
// Load as soon as the tab is actually shown (activated), but not while it sits in the background.
if (document.visibilityState === 'visible') setTimeout(() => document.visibilityState === 'visible' && go(), 150);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && go());
