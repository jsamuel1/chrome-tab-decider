// The onboarding profile as a short paragraph the classifier reads with every decision.

const MAX = 600;

export function profileText(profile) {
  const p = profile || {};
  const company = String(p.company || '').trim();
  const domains = (p.companyDomains || []).filter(Boolean);
  const work = String(p.work || '').trim();
  const projects = (p.projects || []).map((x) => String(x).trim()).filter(Boolean);
  const categories = (p.categories || []).map((x) => String(x).trim()).filter(Boolean);
  if (!company && !domains.length && !work && !projects.length && !categories.length) return '';

  const parts = [];
  if (company || work) {
    let s = 'This person works';
    if (company) s += ` at ${company}`;
    if (domains.length) s += ` (${domains.join(', ')})`;
    if (work) s += ` as ${work}`;
    parts.push(s + '.');
  }
  if (domains.length) parts.push('Pages on those domains are usually work.');
  const tail = p.style === 'generic'
    ? 'Tabs are grouped by general topic.'
    : 'Work tabs are grouped by project or customer; personal tabs by general topic.';

  // Projects are the only unbounded part, so they get whatever room is left.
  const fixed = [...parts, tail].join(' ');
  if (projects.length) {
    let list = '';
    for (const name of projects) {
      const next = list ? `${list}, ${name}` : name;
      if (fixed.length + ' Current projects: .'.length + next.length > MAX) break;
      list = next;
    }
    if (list) parts.push(`Current projects: ${list}.`);
  }
  parts.push(tail);
  return parts.join(' ').slice(0, MAX);
}
