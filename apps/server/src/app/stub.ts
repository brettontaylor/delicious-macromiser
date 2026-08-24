/**
 * Roadmap placeholders — a planned feature drawn in the place it will occupy.
 *
 * Extracted the moment a second page needed one, following the same rule as
 * `mcp/tools/sets.ts`: two copies of a thing is how the two copies start to
 * differ. Title and destination come from `domain/roadmap.ts`, so a placeholder
 * cannot drift from the roadmap row it points at.
 *
 * Callers must gate these on the EDIT capability. A read link exists to be
 * shared, and a shared link should show a product rather than a building site.
 */

import { esc } from './layout.ts';
import { roadmapItem } from '../domain/roadmap.ts';

/**
 * `preview` is a fixed literal from the calling module — never user data — so
 * it is interpolated unescaped to allow the entities the sketches need
 * (`&times;`, `&middot;`). Never pass anything that came out of D1.
 */
export function roadmapStub(id: string, secret: string, preview: string): string {
  const item = roadmapItem(id);
  if (!item) return '';
  return `<a class="stub" href="/app/${esc(secret)}/roadmap#${esc(item.id)}">
    <span class="stub-top">
      <span class="stub-title">${esc(item.title)}</span>
      <span class="stub-tag">Planned</span>
    </span>
    <span class="stub-preview">${preview}</span>
  </a>`;
}
