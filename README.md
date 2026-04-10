# Delicious Macromiser 🍖

A personal, printable recipe system — beautifully designed, AI-assisted, and built to grow.

Each recipe is a **self-contained, print-ready 2-page HTML file** with a consistent aesthetic: Cormorant Garamond titles, Josefin Sans labels, Libre Baskerville body text, and a cream/burgundy/sienna palette. No frameworks, no build tools, no dependencies beyond Google Fonts.

---

## What's in this repo

```
delicious-macromiser/
├── README.md                        ← you are here
├── RECIPE_FORMAT.md                 ← full format spec (read before generating)
├── BASE_TEMPLATE.html               ← HTML/CSS shell with all placeholders
│
├── braised-pork-shoulder.html       ← Red Wine Braised Pork Shoulder
├── galbi-jjim.html                  ← Galbi Jjim (Korean Braised Short Ribs)
├── spicy-heritage-chicken-ragu.html ← Spicy Heritage Chicken Ragù
├── sirloin-tagliata.html            ← Sirloin Tagliata with Smashed Potatoes
└── french_lemon_vinaigrette.md      ← Quick vinaigrette reference
```

---

## Viewing & Printing

Open any `.html` file in a browser. Click the **Print Recipe** button at the bottom, or hit `Ctrl+P` / `Cmd+P`. Print settings:
- Paper size: **Letter**
- Margins: **None**
- Background graphics: **On**

Each recipe prints as exactly **2 pages**.

---

## The Design System

The visual system is defined across two files:

- **`BASE_TEMPLATE.html`** — the complete HTML/CSS shell. All color variables, typography, and component classes live here.
- **`RECIPE_FORMAT.md`** — the content spec. Rules for every zone of every page: header, ingredients, steps, notes banner, footer, plating box, extras. Read this before generating anything.

### Color Palette

| Variable | Hex | Use |
|---|---|---|
| `--ink` | `#1a1510` | Body text |
| `--burgundy` | `#6b1f2a` | Titles, accents, notes banner bg |
| `--sienna` | `#8c4a2f` | Section titles, labels |
| `--cream` | `#f5f0e8` | Page background |
| `--tan` | `#d4c4a8` | Step numbers, dotted rules |
| `--rule` | `#b8a88a` | Borders, dividers, footer text |
| `--muted` | `#6b5f52` | Subtitles, meta keys |

### Typography

| Role | Font | Weight | Size |
|---|---|---|---|
| H1 main title | Cormorant Garamond | 300 | 34pt |
| H2 page 2 title | Cormorant Garamond | 300 | 26pt |
| Section titles | Josefin Sans | 600 | 7.5pt, uppercase, tracked |
| Step body | Libre Baskerville | 400 | 7.8pt |
| Ingredient qty | Josefin Sans | 600 | 7.5pt |
| Notes banner | Cormorant Garamond italic | 400 | 9pt |

---

## Working with Claude Code

This project is designed to be **generated and maintained with Claude Code** — Anthropic's AI coding assistant. Here's how to get set up and start collaborating.

### Setup

1. Install [Claude Code](https://claude.ai/code) (VS Code extension or CLI)
2. Clone this repo and open it: `cd delicious-macromiser && claude`
3. Claude will read the project files and be ready to generate recipes

### Generating a new recipe

Just describe the dish — Claude will read `RECIPE_FORMAT.md` and `BASE_TEMPLATE.html` automatically and produce a correctly formatted `.html` file.

**Example prompts:**

```
Generate a recipe for slow-roasted lamb shoulder with preserved lemon gremolata
and a white bean side.
```

```
Generate a recipe from these notes:
- roast chicken, spatchcocked
- compound butter: tarragon, lemon zest, garlic
- sides: roasted fennel + crispy shallots
```

```
Generate a pasta recipe — something with brown butter, sage, and ricotta.
The side should be a simple green salad.
```

Claude handles everything: inferring measurements, writing step titles, generating the chef's note, writing plating instructions. The output drops straight into `recipes/` ready to print.

### Modifying the design system

The entire visual system is in `BASE_TEMPLATE.html`. You can ask Claude to:

```
Update the font size of step text to 8.5pt across all recipes
```

```
Change the notes banner color to a deep forest green
```

```
Add a new "Difficulty" meta item to the header row format
```

Claude will update `BASE_TEMPLATE.html` and `RECIPE_FORMAT.md` together and can regenerate existing recipes to match.

### The Pencil design file

There is a companion **Pencil design system file** (`recipe-design-system.pen`) that renders every component of the system visually — color swatches, all type styles, atoms, molecules, and pattern components — in a single canvas.

To access it, you need the **[Pencil extension for VS Code](https://marketplace.visualstudio.com/items?itemName=highagency.pencildev)**. Once installed, ask Claude:

```
Recreate the recipe design system in Pencil — all color swatches, typography
styles, atoms (Meta Item, Divider, Section Title), molecules (Meta Row,
Ingredient Row, Step Item), and patterns (Notes Banner, Pairing Note,
Extra Box, Page Footer).
```

Claude will build the full design system canvas using the Pencil MCP tools. From there you can inspect, modify, and extend the visual system directly — and ask Claude to keep the HTML and the Pencil file in sync.

---

## Collab notes

- **Don't edit CSS variables directly** — change them in `BASE_TEMPLATE.html` and let Claude propagate the update to existing recipes
- **Always 2 pages max** — Page 1 is the main dish, Page 2 is sides + plating
- **Inline measurements in steps** — every step should repeat quantities inline; don't make the cook cross-reference the ingredient list
- **The chef's note is opinionated** — one strong, non-obvious observation per recipe, not generic encouragement

---

Built by Brett · Powered by Claude Code
