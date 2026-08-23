# RECIPE_FORMAT.md — Format Specification

All recipes follow this spec. Read this before generating any recipe HTML.

---

## Page Structure

### Page 1 — Main Dish
| Zone | Content |
|---|---|
| Header | Label · H1 title (italic first word) · Subtitle · Meta row |
| Body | Two columns: Ingredients (left, 2.2in) + Steps (right, flex) |
| Footer banner | Dark burgundy `notes-banner` with chef's note |
| Page footer | Dish name left · "Page 1 of 2" right |

### Page 2 — Sides, Plating & Notes
| Zone | Content |
|---|---|
| Header | Label · H2 title · Subtitle · horizontal rule |
| Body | Sides grid (1fr 1fr) with ingredients + steps per side dish |
| Plating box | Bordered box: full plating and serving instructions |
| Extras row | 2-column grid: Make Ahead + key notes / wine pairing / etc. |
| Page footer | Side dish name left · "Page 2 of 2" right |

---

## Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| H1 main title | Cormorant Garamond | 300 | 34pt |
| H2 page 2 title | Cormorant Garamond | 300 | 26pt |
| Section titles | Josefin Sans | 600 | 7.5pt, uppercase, tracked |
| Label / meta keys | Josefin Sans | 400 | 7–8.5pt, uppercase |
| Meta values | Josefin Sans | 600 | 10pt |
| Step numbers | Cormorant Garamond | 600 | 17pt |
| Body / step text | Libre Baskerville | 400 | 7.8pt |
| Ingredient qty | Josefin Sans | 600 | 7.5pt |
| Notes banner | Cormorant Garamond italic | 400 | 9pt |

---

## Color Variables (do not change)
```css
--ink:      #1a1510   /* body text */
--burgundy: #6b1f2a   /* primary accent, titles, notes banner bg */
--sienna:   #8c4a2f   /* section titles, label text */
--cream:    #f5f0e8   /* page background */
--tan:      #d4c4a8   /* step numbers, dotted rule */
--rule:     #b8a88a   /* borders, dividers, footer text */
--muted:    #6b5f52   /* subtitle, meta keys */
```

---

## Component Rules

### Ingredient List
- `<ul>` with no list-style
- Each `<li>`: flex row, qty span (min-width 0.55in, Josefin Sans bold burgundy) + name span
- Dotted bottom border on each item except last
- Qty format: use fractions (½, ¼) not decimals where possible

### Step List
- `<ol>` with no list-style
- Each `<li>`: flex row, large faded step number + content div
- Content div: `.step-title` (Josefin Sans, uppercase, small) + `.step-text` (Baskerville)
- Keep step text tight — 2–4 sentences max per step
- **Always repeat measurements inline in the step text.** Do not rely on the reader to cross-reference the ingredient list. Write "add 1½ tsp red pepper flakes" in the step, not just "add the red pepper flakes." This is the single most important usability rule for cooking from the page.

### Section Dividers
```html
<div class="divider-ornament">— Label —</div>
```
Used to split ingredient groups (e.g., Marinade vs. Braise Day, or finishing ingredients)

### Notes Banner (Page 1 footer)
```html
<div class="notes-banner">
  <div class="nb-label">Chef's Note</div>
  <div class="nb-text">...</div>
</div>
```
Always 1–3 sentences. Should contain the most critical technique or make-ahead tip.

### Page Border
Each `.page` uses `::before` (thin rule, 0.22in inset) and `::after` (2.5px burgundy, 0.28in inset) pseudo-elements for the double-border frame effect.

---

## Content Guidelines

### Meta Row (always 4–5 items)
Standard items: Prep · Cook/Braise · Oven Temp · Serves  
Add Marinate if overnight rest is required. Use "—" if a value doesn't apply.

### H1 Title Format
First meaningful word or modifier should be wrapped in `<em>` for italic contrast:
```html
<h1><em>Red Wine</em> Braised Pork Shoulder</h1>
<h1><em>Galbi Jjim</em><br>Braised Beef Short Ribs</h1>
```

### Subtitle
Dot-separated flavor/technique descriptors, 3–5 items:
```
Soffritto · San Marzano · Fresh Herbs · Finished with Butter
```

### Chef's Note
One strong, opinionated observation. Prioritize: non-negotiable ingredient, make-ahead advice, or key technique warning. Never generic.

### Step Titles (uppercase labels)
Be specific and active: "Deglaze", "Add Veg — Second Stage", "Temper & Sear"
Avoid vague labels like "Cook" or "Step 3"

---

## Print Behavior
```css
@media print {
  @page { size: letter; margin: 0; }
  .page { width: 100%; margin: 0; padding: 0.5in 0.6in; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  .print-btn { display: none; }
}
```
Print button is always the last element in `<body>`, hidden on print.

---

## Nutrition (schema.org/Recipe JSON-LD)

Every card carries a machine-readable nutrition block. This is what lets the
MCP server log a cooked dish at full confidence instead of re-estimating it —
the portions were written down when it was cooked, so the numbers are evidence
rather than a guess.

Put a single `<script type="application/ld+json">` in the `<head>`:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Red Wine Braised Pork Shoulder",
  "recipeYield": "8 servings",
  "nutrition": {
    "@type": "NutritionInformation",
    "servingSize": "1 plated serving",
    "calories": "780 kcal",
    "proteinContent": "52 g",
    "fatContent": "44 g",
    "carbohydrateContent": "38 g",
    "fiberContent": "4 g"
  },
  "x-components": [
    { "name": "Braised pork", "calories": "560 kcal", "proteinContent": "48 g",
      "fatContent": "36 g", "carbohydrateContent": "6 g" },
    { "name": "Polenta",      "calories": "220 kcal", "proteinContent": "4 g",
      "fatContent": "8 g",  "carbohydrateContent": "32 g" }
  ]
}
</script>
```

### Rules

1. **`nutrition` describes one full plated serving — page 1 and page 2 together.**
   That is what a person actually eats, and it is the number the log needs. A
   main-dish-only figure silently under-reports every meal by the side dish.
2. **`x-components` breaks that down per component**, so a serving eaten without
   the rice or the polenta can still be logged accurately. Not part of
   schema.org; the `x-` prefix marks it as ours.
3. **Divide by the yield, not by the pan.** `recipeYield` must be a number the
   totals were actually divided by. A range on the card ("2 – 3") must resolve to
   one number here — pick the larger, so a serving is never overstated.
4. **Only count what the ingredient list contains.** If a component's ingredients
   are not written on the card, it does not get a number. Add the ingredients
   first, or leave the recipe out of the catalog. An invented figure logged at
   high confidence is worse than no recipe at all — it corrupts the trend data
   the whole system exists to produce.
5. **Units are explicit strings** (`"780 kcal"`, `"52 g"`) as schema.org
   specifies. The build script parses the leading number.
6. Alcohol that cooks off is not counted. A splash of wine in a braise
   contributes its sugars, not its ethanol.

Run `npm run recipes:check` before committing. It reports every card still
missing this block.

---

## Checklist Before Saving
- [ ] Exactly 2 `.page` divs
- [ ] Both pages have `.footer` with correct page numbers
- [ ] All CSS vars used — no hardcoded colors outside `:root`
- [ ] Google Fonts link present in `<head>`
- [ ] Print button present and functional
- [ ] File saved to `recipes/[kebab-case-name].html`
- [ ] Opened in browser locally to verify layout
