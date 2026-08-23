import type { Ctx } from '../../db/queries.ts';
import type { RawContent } from '../server.ts';
import type { ToolArgs } from './index.ts';

/**
 * TEMPORARY - US-1 Phase 0 spike.
 *
 * The whole photo-logging design rests on one unproven assumption: that an MCP
 * client passes an `image` content block from a tool result through to the
 * model. The protocol defines it; whether a given client honours it is a
 * different question, and the answer decides how much of US-1.2 survives.
 *
 * This returns a 3x3 grid of filled and empty cells. There are 512 possible
 * arrangements, so a model that reports the right one has genuinely seen the
 * image rather than guessed.
 *
 * DELETE once the finding is recorded in docs/plans/us-1-log-a-meal-in-the-app.md.
 */
const TEST_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAUoAAAFKCAIAAAD0S4FSAAAER0lEQVR42u3TMREAMAgEQWzg32AkpKVImYKBXQk/f3GAocIEIG9A3oC8AXkD8gbkDfIG5A3IG5A3IG9A3iBvQN6AvAF5A/IG5A3yhkaSQt7IW97yRt7yBnnLG+Qtb5C3vEHS8kbe8pY38pY3yFveIG95g7zlDfKWN/KWt7yRt7zljbzlDfKWN8hb3iBveSNvecsbectb3shb3iBveYO85Q3yljfyRt7IW97yRt7yBnnLG+Qtb5C3vEHe8kbe8pY38pY3yFveIG95g7zlDfKWN/KWt7yRt7zljbzlDfKWN8hb3iBveSNv5I285S1v5C1vkLe8Qd7yBnnLG+Qtb+Qtb3kjb3mDvOUN8pY3yFveIG95I295yxt5y1veyFveIG95g7zlDfKWN/KWt7yRt7zljbzlDfKWN8hb3iBveSNv5I285S1v5C1vkLe8Qd7yBnnLG+Qtb+Qtb3kjb3k7E/KWN8hb3iBveYO85Y285S1v5C1veSNveYO85Q3yljfIW97IG3kjb3nLG7aRN8gbkDcgb0DegLwBeYO8AXkD8gbkDcgbkDfIG5A3IG9A3oC8AXmDvAF5A/IG5A3IG5A3IG+QNyBvQN6AvAF5A/IGeQPyBuQNyBuQNyBvkDcgb0DegLwBeQPyBuQN8gbkDcgbkDcgb0DeIG9A3oC8AXkD8gbkDfIG5A3IG5A3IG9A3iBvQN6AvAF5A/IG5A3IG+QNyBuQNyBvQN6AvEHegLwBeQPyBuQNyBvkDcgbkDcgb0DegLwBeYO8AXkD8gbkDcgbkDfIG5A3IG9A3oC8AXmDvAF5A/IG5A3IG5A3yNsEIG9A3rwkha1+bSVvectb3shb3vJG3vKWNy4rb3nL22VtJW95y9tW8pa3vOUtb3nLW97IW97yxmXlLW95u6yt5C1vedtK3vKWt7zlLW95yxt5y1veyFve8pY38pa3vOWNvOUtb3nLW97yljfylre8kbe85Y3Lylve8nZZW8lb3vK2lbzlLW95I295yxt5y1veuKy85S1vl7WVvOUtb1vJW97ylre85S1veSNvecsbl5W3vOWNreQtb3kjb3nLW97ylre85Y285S1v5C1veeOm8pa3vF3WVvKWt7xtJW95y1veyFve8kbe8pY3LitvecvbZW0lb3nL21bylre85S1vectb3shb3vLGZeUtb3m7rK3kLW9520re8pa3vOUtb3nLG3nLW97IW97yljfylre85Y285S1vectb3vKWN/KWt7yRt7zljcvKW97ydllbyVve8raVvOUtb3kjb3nLG3nLW964rLzlLW+XtZW85S1vW8lb3vKWt7zlLW95I295yxt5y1ve8kbe8pa3vJG3vOUtb3nLW97yRt7yljfylre8cVl5y1veLmsrectb3raSt7zlLW9gHnmDvAF5A/IG5A3IG5A3yBuQNyBvQN6AvAF5g7wBeQPyBuQNyBuQN6x2AfPLeLh8p69AAAAAAElFTkSuQmCC';

export async function spikeImage(_ctx: Ctx, _args: ToolArgs): Promise<RawContent> {
  return {
    text:
      'Phase 0 spike. The image is a 3x3 grid of squares; each cell is either ' +
      'dark (filled) or light (empty). Report the grid row by row, top to ' +
      'bottom, left to right. Do not guess - if no image reached you, say so plainly.',
    __mcpContent: [{ type: 'image', data: TEST_PNG_B64, mimeType: 'image/png' }],
  };
}
