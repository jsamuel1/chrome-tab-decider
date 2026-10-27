// No-AI fallbacks: keyword discovery over titles and token-overlap assignment.

const STOP = new Set(`a an and are as at be by for from has have how i in is it its of on or our the this to was we what when where which who why will with you your
new home page sign log login welcome dashboard untitled loading official site free online best top vs via using use get de la le el en und der die das
com www http https html index view edit open search results inbox mail google youtube amazon reddit github chrome tab tabs`.split(/\s+/));

// Well-known hosts → seed folder, used only as hints when no LLM is available.
const HOST_HINTS = [
  [/github|gitlab|bitbucket|stackoverflow|stackexchange|npmjs|pypi|readthedocs|developer\.|docs\.|mdn|devdocs/, 'Dev'],
  [/aws\.amazon|console\.aws|cloud\.google|portal\.azure|cloudflare|vercel|netlify/, 'Cloud'],
  [/mail\.|outlook|gmail|calendar|slack|teams\.microsoft|zoom\.us|meet\.google|chime/, 'Comms'],
  [/youtube|netflix|twitch|spotify|vimeo|primevideo|disneyplus/, 'Media'],
  [/amazon\.|ebay|etsy|aliexpress|bunnings|jbhifi|officeworks|shop|store/, 'Shopping'],
  [/news|bbc|abc\.net|cnn|nytimes|theguardian|smh\.com|reuters|bloomberg|ycombinator/, 'News'],
  [/twitter|x\.com|facebook|instagram|linkedin|reddit|mastodon|bsky|threads/, 'Social'],
  [/claude\.ai|chatgpt|openai|anthropic|huggingface|gemini\.google|perplexity|arxiv/, 'AI'],
  [/docs\.google|notion|confluence|quip|sharepoint|office|dropbox|drive\.google|wiki/, 'Docs'],
  [/booking|airbnb|expedia|skyscanner|qantas|virgin|maps\.google|tripadvisor/, 'Travel'],
  [/bank|paypal|stripe|commbank|anz|westpac|nab\.com|finance|invest/, 'Finance'],
];

export function hostHint(domain) {
  for (const [re, name] of HOST_HINTS) if (re.test(domain)) return name;
  return null;
}

export function words(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]{1,}/gu) || [])
    .map((w) => w.replace(/[.-]+$/, ''))
    .flatMap((w) => (w.includes('-') ? [w, ...w.split('-')] : [w]))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

const title = (w) => ((w.length <= 4 || (w.length <= 7 && /\d/.test(w))) && /^[a-z0-9]+$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));

/** items: [{domain, title}] → [{name, description}] */
export function heuristicDiscover(items, max = 8) {
  const df = new Map(); // word -> Set(domain)
  const hints = new Map();
  for (const it of items) {
    for (const w of new Set(words(it.title))) {
      if (!df.has(w)) df.set(w, new Set());
      df.get(w).add(it.domain);
    }
    const h = hostHint(it.domain);
    if (h) hints.set(h, (hints.get(h) || 0) + 1);
  }
  const topics = [...df.entries()]
    .filter(([, d]) => d.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, Math.ceil(max / 2))
    .map(([w, d]) => ({ name: title(w), description: `Tabs about ${w} (${[...d].slice(0, 3).join(', ')})` }));
  const hinted = [...hints.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => ({ name: n, description: `${n} sites` }));
  const out = [];
  const seen = new Set();
  for (const c of [...topics, ...hinted]) {
    if (seen.has(c.name.toLowerCase())) continue;
    seen.add(c.name.toLowerCase());
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** Pick a category name by keyword overlap; null if nothing matches. */
export function heuristicAssign(domain, titles, categories) {
  const bag = new Map();
  for (const t of titles) for (const w of words(t)) bag.set(w, (bag.get(w) || 0) + 1);
  let best = null;
  let bestScore = 0;
  const hint = hostHint(domain);
  for (const c of categories) {
    let s = 0;
    for (const w of words(`${c.name} ${c.description || ''}`)) s += bag.get(w) || 0;
    if (hint && hint.toLowerCase() === c.name.toLowerCase()) s += 2;
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}
