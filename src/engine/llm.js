// Chrome built-in LLM (Prompt API / Gemini Nano): one pass over tab titles → candidate folders.

const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

export function hasPromptApi() {
  return typeof globalThis.LanguageModel !== 'undefined';
}

export async function llmAvailability() {
  if (!hasPromptApi()) return 'unsupported';
  try {
    return await LanguageModel.availability(LANG);
  } catch (e) {
    return 'unavailable';
  }
}

/** Must be called from a user gesture if the model still needs downloading. */
export async function prepareLLM(onProgress = () => {}) {
  if (!hasPromptApi()) throw new Error('Prompt API not available in this Chrome');
  const s = await LanguageModel.create({
    ...LANG,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
    },
  });
  s.destroy();
  return llmAvailability();
}

const SYSTEM = `You organize a person's open browser tabs into a few top-level folders (tab groups).
Folder names: 1–2 words, Title Case, short enough for a tab-group label (max 18 characters), no emoji, no punctuation.
Prefer topics/projects/activities ("Trip Planning", "ESP32", "AWS Docs", "Shopping") over generic site types when the titles support it.
Never create a folder named "Other", "Misc" or "General".`;

const schema = (max) => ({
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      maxItems: max,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 18 },
          description: { type: 'string', maxLength: 90 },
        },
        required: ['name', 'description'],
      },
    },
  },
  required: ['categories'],
});

/**
 * Single pass over titles. items: [{domain, title}], existing: [{name, description}]
 * Returns [{name, description}] — the new or kept folders (deduped against existing by name).
 */
export async function discoverCategories(items, existing = [], { max = 8, mode = 'full' } = {}) {
  const session = await LanguageModel.create({ ...LANG, initialPrompts: [{ role: 'system', content: SYSTEM }] });
  try {
    const budgetChars = Math.max(2000, ((session.contextWindow || session.inputQuota || 4096) - 900) * 3);
    const lines = [];
    let used = 0;
    for (const it of items) {
      const line = `- [${it.domain}] ${it.title.slice(0, 90)}`;
      if (used + line.length > budgetChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    const existingText = existing.length
      ? `Existing folders (keep any that still fit, reuse their exact names):\n${existing.map((c) => `- ${c.name}: ${c.description || ''}`).join('\n')}\n\n`
      : '';
    const ask =
      mode === 'incremental'
        ? `These tabs did not fit any existing folder. Propose up to ${Math.min(3, max)} NEW folders that would hold several of them. Return an empty list if they are unrelated one-offs.`
        : `Propose the ${max} or fewer folders that best organize ALL of these tabs. Every folder should fit at least two tabs. Same-site tabs belong together.`;
    const prompt = `${existingText}Open tabs ([site] title):\n${lines.join('\n')}\n\n${ask}`;
    const raw = await session.prompt(prompt, { responseConstraint: schema(max), omitResponseConstraintInput: true });
    const parsed = JSON.parse(raw);
    return cleanCategories(parsed.categories || []);
  } finally {
    session.destroy();
  }
}

/** Fallback assignment when the decider model isn't downloaded. */
export async function llmAssign(state, names) {
  const session = await LanguageModel.create({ ...LANG, initialPrompts: [{ role: 'system', content: SYSTEM }] });
  try {
    const raw = await session.prompt(
      `${state}\n\nWhich folder should these tabs go in? Folders: ${names.join(', ')}`,
      {
        responseConstraint: { type: 'object', properties: { folder: { type: 'string', enum: names } }, required: ['folder'] },
        omitResponseConstraintInput: true,
      }
    );
    return JSON.parse(raw).folder;
  } finally {
    session.destroy();
  }
}

export function cleanCategories(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const name = String(c.name || '')
      .replace(/[^\p{L}\p{N}&+.\- ]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18)
      .replace(/[.\-&+ ]+$/, '');
    if (!name || /^(other|misc|miscellaneous|general|uncategorized)$/i.test(name)) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name, description: String(c.description || '').trim().slice(0, 90) });
  }
  return out;
}
