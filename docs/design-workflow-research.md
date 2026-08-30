# Research: design workflows for the Common Notes overhaul

Findings gathered while planning the user-test fixes (August 2026). The design
overhaul itself is separate work with its own ticket; this document records what
the available tools do, how people use them, and the state of the styling code
the overhaul will land on.

## The skill Jim meant: `/design`

The skill from the test notes is `/design`, the artboard canvas that Anthropic
added to Claude Code in August 2026, still labelled a research preview. It is
already available in this environment. Running it with a brief publishes a
pan-and-zoom canvas of editable screens: you tweak them by hand in the browser
with click-to-select, a properties panel and inline text editing, and then ask
for the one you picked to be implemented. It needs Claude Code v2.1.233 or
later.

## A related skill found during the research: `frontend-design`

`frontend-design` is a separate official Anthropic plugin, already downloaded to
`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/`
but not enabled (no plugins from that marketplace are). Enabling it is
`/plugin install frontend-design@claude-plugins-official`.

Unlike `/design` it is not a drawing tool. It is roughly 400 words of
instruction imposing a two-pass process:

1. **Write a compact design plan first.** Four things by name: a palette of four
   to six colours; the typefaces for two or three roles, meaning a display face
   used with restraint, a body face, and a utility face for captions or data; a
   layout concept sketched in prose and ASCII; and a single "signature" element
   the design will be remembered by.
2. **Then attack that plan before building.** Work through the brief as if from
   scratch, see whether you arrive somewhere similar, and revise any part that
   turns out to be the answer you would have given for any similar page.

The rest is principles rather than process. Three are directly relevant to an
annotation overlay: spend your boldness in one place and keep everything around
it quiet; match complexity to the vision, since minimal directions need
precision in spacing and type rather than an absence of effort; and critique
your own work with screenshots as you build.

It also has a section on interface copy that overlaps almost exactly with the
rules already in Jim's CLAUDE.md.

## The warning that matters most here

The skill keeps a calibration list of the looks machine-generated design
converges on regardless of subject. There are three, and one is:

> a broadsheet-style layout with hairline rules, zero border-radius, and dense
> newspaper-like columns

That is close to the near-black-and-white minimal direction Jim asked for. The
skill's own resolution is that the brief always wins, so this does not change
the goal. What it means is that "minimal" has to be reached through precision in
spacing, type and detail rather than by deleting colour, or we trade one
machine-made look for another and the same complaint comes back.

The other two, for completeness: a warm cream background with a high-contrast
serif and a terracotta accent; and a near-black background with a single acid
green or vermilion accent.

## Three tools, three different jobs

| Tool | What it is | What it does |
| --- | --- | --- |
| `design` | the artboard canvas described above | drawing and choosing between directions you can see side by side |
| `frontend-design` | instructions, no output of its own | the discipline: plan, critique, then build |
| `playground` | a self-contained HTML page with controls on one side and a live preview on the other | tuning quantities: radius, spacing, border width, colour count |

`playground` is a third official plugin from the same marketplace. Its design
template maps controls to decisions directly: sliders for
sizes, spacing and radius; toggles for whether a border exists at all;
dropdowns for typefaces and easing; a viewport-width slider for responsive
behaviour. The page ends with a generated description of what you chose, which
you copy back into the conversation. For a complaint shaped like "too many
colours, too many tiny borders" this is a better instrument than a static
mockup, because those are quantities rather than concepts.

## What people actually do

Every account I found converges on the same five moves, set out most clearly in
a write-up of turning one design into a reusable skill:

1. Generate several variants with genuinely **different personalities**, not
   small tweaks. The example asked for five, named Neo-Brutalist, Glass Aurora,
   Editorial Mono, Warm Minimal and Dark Command.
2. Pick one, then ask for its light and dark versions as a considered pair
   rather than an inversion.
3. Extract the result into two artifacts: a written design system of a few
   hundred lines, and an interactive HTML style guide showing every component.
4. Package that as a project skill under `.claude/skills/`, holding the
   instructions, a token reference and a component template.
5. Apply it to real pages, **one page at a time**. The repeated warning is not
   to redesign a whole application at once.

A second pattern worth knowing is a set of community skills that split design
into four modes: **Build** a page from scratch, **Study** a screenshot to
extract its design DNA, **Audit** an existing interface to diagnose what is
wrong with it, and **Redesign** existing content with a deliberately different
structure. For Common Notes, which already exists, Audit is the mode that fits
the starting position, and it is the step the popular workflows skip because
they mostly start from nothing.

## Decision

Jim has decided to use the `/design` skill, the artboard canvas, as the workflow
for the design overhaul.

## The engineering underneath

Worth recording because it is why the interface drifted, and it is independent
of whatever look wins.

There is no design token layer anywhere in the product, and there are two
unrelated dark-mode mechanisms. The extension uses real Tailwind `dark:`
variants switched by a `.dark` class on each shadow root. The website ignores
`.dark` entirely and instead re-colours raw Tailwind utility class *names* under
`html[data-scheme]`, in a 377-line `src/everything-web/src/design.css`. Every
shared component therefore carries two independently maintained dark palettes,
and only one is live on any given screen.

Measured over the note UI alone: 72 distinct colour utility strings resolving to
47 palette steps across five hue families, 120 one-pixel borders, five radii and
five shadow sizes applied inconsistently. The note popover is `shadow-xl` while
the visually identical YouTube card is `shadow-2xl`; the ellipsis menu is
`shadow-sm` on notes and `shadow-xl` on note-not-needed entries. Three more
copies of the palette are hard-coded as hex in the parts injected into the host
page, which cannot reach Tailwind at all.

Five of the website's seven colour schemes are unreachable, because
`src/everything-web/src/components/DesignMenu.tsx:46` sets
`SHOW_DESIGN_MENU = false`. Only light and dark can be selected by anyone.

The shape of the fix: one `tokens.css` declaring custom properties against three
selectors at once, `html` for the website, `.cn-theme-root` for the extension's
shadow roots, and a third class for elements injected into host pages; a small
second layer of plain CSS classes that components write instead of raw palette
utilities, because a plain class behaves identically under the website's CDN
Tailwind, the extension's compiled Tailwind, and inside a shadow root; the
website moved onto the same `.dark` class the extension uses; and the five dead
schemes deleted. The rule that makes the migration safe is that each component's
rewrite deletes the matching `[data-scheme="dark"]` rules in the same commit,
because `design.css` themes by overriding utility class names, so a component
that stops writing `bg-blue-50` silently loses its dark appearance.

## Sources

- [Improving frontend design through Skills, Anthropic](https://claude.com/blog/improving-frontend-design-through-skills)
- [The /design artboard skill in Claude Code](https://www.explainx.ai/blog/claude-code-design-command-artboards-research-preview-2026)
- [Turning one design into a reusable Claude skill](https://www.nathanonn.com/claude-skill-design-system-reusable-frontend/)
- [Design skills for Claude Code, overview](https://composio.dev/content/top-design-skills)
- [Design skills that follow a real design process](https://medium.com/@julian.oczkowski/7-claude-code-design-skills-that-follow-a-real-design-process-b871b8673d05)
- The `frontend-design` and `playground` skills themselves, read on disk at
  `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/`
