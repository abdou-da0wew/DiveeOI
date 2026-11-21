# Awesome Claude Motion Graphics — 17 style prompts

Source: https://awesomeclaude.ai/claude-motion-graphics
Retrieved: 2026-11-20

The source page explicitly permits copying its prompt templates into prompts and skills. This archive preserves the original 17 prompts and numeric style rules. Adapted DiveeOI skills live in `.agents/skills/`; the original upstream assets and MIT-licensed skills remain in `third_party/motion-graphics/`.

## Swiss grid & kinetic type

A modular grid, one typeface, one signal colour. Type snaps into cells like a printing press.

**Good for:** Brand identity, Event openers, Conference titles

**Suggested stack:** Canvas 2D or SVG

**Palette:** #f5f2ea, #111111, #e63323

**Rules**

- One easing curve for snaps, cubic-bezier(.7,0,.2,1). Linear only for lines being drawn.
- Entrances are wipes or clip reveals, never fades. Deletions are hard cuts.
- Exactly one element carries the signal colour per shot. That element is the subject.
- Every position lands on a 12-column grid with 4% margins.

**Avoid:** Overshoot, springs, drop shadows, more than one typeface, centred-everything layouts

**Original style prompt**

Style: Swiss International motion design. Off-white #f5f2ea, black #111, one signal red #e63323 used on a single element per shot. One grotesk typeface in two weights. A visible 12-column grid with 4% margins; every element snaps to it. Snaps use cubic-bezier(.7,0,.2,1), lines draw at linear speed. Entrances are wipes and clip reveals, never fades; exits are hard cuts on the beat. No overshoot, no shadows, no gradients.

## Flat vector explainer

Flat colour shapes and simple geometric characters with springy, confident movement.

**Good for:** SaaS promos, Onboarding, Science explainers

**Suggested stack:** SVG + GSAP

**Palette:** #fdf6ec, #2b2d42, #ff6b35, #4ecdc4, #ffd23f

**Rules**

- Entrances overshoot with cubic-bezier(0.34,1.56,0.64,1) and settle within 12 frames.
- Stagger groups by 2 to 4 frames, never all at once.
- Transitions are carried by an element: a shape grows to fill the frame and becomes the next background.
- Four to five flat colours, no gradients, no outlines thinner than 3px at 1080p.

**Avoid:** Stock-illustration people with tiny heads, gradients, crossfades between scenes

**Original style prompt**

Style: flat vector explainer. Palette #fdf6ec background, #2b2d42 ink, accents #ff6b35, #4ecdc4, #ffd23f. Geometric shapes and simple characters built from circles and rounded rectangles, no gradients. Entrances overshoot with cubic-bezier(0.34,1.56,0.64,1) and settle within 12 frames, groups stagger by 3 frames. Scene changes are carried by a shape that grows to fill the frame and becomes the next background. No crossfades.

## Shape morph & liquid

One shape keeps turning into the next. The story is told by transformation, not cuts.

**Good for:** Music videos, Brand stories, Transitions between topics

**Suggested stack:** SVG path morphing, or WebGL metaballs for liquid

**Palette:** #0d1b2a, #f72585, #7209b7, #4cc9f0

**Rules**

- There are no cuts. Every new idea grows out of the previous shape.
- Each morph takes 18 to 30 frames and passes through a readable in-between shape.
- Hold each finished shape at least 1 second so it reads.
- Liquid joins use smooth-min blending, never a hard overlap.

**Avoid:** Morphs that pass through a shapeless blob, constant motion with no holds

**Original style prompt**

Style: continuous shape morph. Dark #0d1b2a field, shapes in #f72585, #7209b7, #4cc9f0. No cuts: each idea grows out of the previous shape through a readable in-between form over 18 to 30 frames, then holds for at least 1 second. Liquid moments use metaball blending so drops merge smoothly. Camera stays still; the shapes do the moving.

## Single line & live drawing

One ink line draws itself, never lifts, and becomes the next picture. The camera follows the pen.

**Good for:** Minimal ads, Luxury brands, Whiteboard explainers

**Suggested stack:** SVG stroke-dashoffset or Canvas path sampling

**Palette:** #faf7f0, #1a1a1a, #c1121f

**Rules**

- The line draws at a steady speed, linear easing, about 800px per second at 1080p.
- The camera pans to keep the pen tip in the middle third of the frame.
- One fill moment: the closed line floods with colour on a downbeat.
- Constant stroke width, round caps.

**Avoid:** Many lines drawing at once, fades in, text typed letter by letter

**Original style prompt**

Style: single continuous line drawing. Warm paper #faf7f0, ink #1a1a1a, one accent #c1121f. One line, round caps, constant 4px width, draws itself at a steady linear speed of about 800px/s and never lifts; each picture becomes the next by continuing the line. The camera pans to keep the pen tip in the middle third. One moment where a closed shape floods with the accent colour on a beat.

## Data story

Real numbers drawn mark by mark, with one annotation that says why it matters.

**Good for:** Reports, Data journalism, Investor updates

**Suggested stack:** Canvas 2D or SVG + d3 scales

**Palette:** #fffdf7, #222222, #d62828, #457b9d

**Rules**

- One reading per screen. Never show two charts at once.
- Bars grow from the baseline in 20 frames with ease-out; counters roll to the exact value and stop.
- Every number on screen comes from the data you were given.
- Axis labels at least 28px at 1080p so they read on a phone.

**Avoid:** 3D charts, rainbow palettes, decorative gridlines, numbers that are not in the source

**Original style prompt**

Style: editorial data storytelling. Cream #fffdf7, ink #222, one highlight red #d62828 for the series that matters, muted blue #457b9d for the rest. One reading per screen. Bars and lines grow from the baseline over 20 frames with ease-out, counters roll to the exact value and stop dead. One handwritten-style annotation per chart says why the change matters. Labels at least 28px. Use only numbers from the data provided.

## Isometric miniature world

A tidy isometric diorama that builds itself, block by block, and opens up to show how things work.

**Good for:** Architecture diagrams, Supply chains, App feature demos

**Suggested stack:** Three.js orthographic camera, or Canvas with an iso projection

**Palette:** #eef2f3, #2d3142, #ef8354, #4f5d75, #bfc0c0

**Rules**

- True isometric angles. The camera slides, it never rotates in perspective.
- Objects drop in from 40px above with a small bounce, staggered by 3 frames.
- Three tones per material: top light, left mid, right dark.
- Things open to reveal their insides instead of cutting to a new scene.

**Avoid:** Perspective cameras, realistic textures, labels floating without leader lines

**Original style prompt**

Style: isometric miniature world. Orthographic camera at true isometric angles; it slides but never rotates into perspective. Background #eef2f3, ink #2d3142, accent #ef8354, shades #4f5d75 and #bfc0c0. Every block has three flat tones: light top, mid left, dark right. Pieces drop in from 40px above with a small bounce, staggered by 3 frames. To explain a step, lift the roof off a building and show the process inside. Labels use thin leader lines.

## Dark tech keynote

Near-black stage, hairline grid, one accent, light sweeping across a product, one giant number.

**Good for:** Product launches, AI and SaaS, Feature reveals

**Suggested stack:** Canvas 2D, or Three.js for a product model

**Palette:** #0a0a0a, #f5f5f5, #8b8b8b, #ff5a1f

**Rules**

- Slow, long-tail easing, cubic-bezier(.16,1,.3,1), 30 to 45 frames per move.
- One giant number per piece, 30% of frame height, counted up to its exact value.
- Reveals come from light: a soft sweep passes and leaves the object lit.
- The accent colour appears on one thing only.

**Avoid:** Lens flares, neon glow, particle bursts, more than one accent colour

**Original style prompt**

Style: dark tech keynote. Near-black #0a0a0a stage with a faint hairline grid, white #f5f5f5 type, grey #8b8b8b secondary, one accent #ff5a1f on a single element. Slow long-tail easing cubic-bezier(.16,1,.3,1), 30 to 45 frames per move. Objects are revealed by a soft light sweep rather than fades. One giant number at 30% of frame height counts up to its exact value. No lens flares, no glow, no particles.

## Living UI screencast

Looks like a real screen recording, but every pixel is rebuilt in HTML, so the camera can zoom and the UI can act.

**Good for:** Product tutorials, Feature launches, Changelogs

**Suggested stack:** HTML + CSS + SVG, driven by a timeline seeked to t

**Palette:** #ffffff, #f3f4f6, #111827, #2563eb

**Rules**

- Rebuild the real UI with real copy and colours. Never use screenshots.
- The cursor moves on eased curves, 20 to 30 frames per move, and pauses 8 frames before each click.
- Zoom to 1.6x on the detail that matters, then pull back.
- One action every 3 to 4 seconds so the viewer can follow.

**Avoid:** Fake features, cursor teleporting, lorem ipsum, zooming on nothing

**Original style prompt**

Style: living screencast. Rebuild the interface in HTML and CSS with its real copy, fonts and colours; no screenshots. A cursor moves on eased curves over 20 to 30 frames, pauses 8 frames, clicks with a small ripple. The camera zooms to 1.6x on each detail that matters, then pulls back. One action every 3 to 4 seconds. Do not show any feature that the product does not have.

## HUD & terminal

Wireframes, lock-on brackets, rolling numbers and monospace glyph grids.

**Good for:** Developer tools, Spec walkthroughs, Sci-fi and AI demos

**Suggested stack:** Canvas 2D glyph grid, SVG overlays, optional Three.js wireframe

**Palette:** #050b0f, #38e8ff, #ffb000, #1d3540

**Rules**

- All text is monospace and sits on a character grid.
- Numbers roll through random glyphs for 6 to 10 frames before settling on the real value.
- Brackets lock onto a target in 3 steps: wide, tighter, locked with a tick.
- Two colours max on the dark field, plus dim grid lines.

**Avoid:** Heavy glow and bloom, glitch tearing, unreadable tiny text

**Original style prompt**

Style: technical HUD. Dark #050b0f field, cyan #38e8ff primary, amber #ffb000 for warnings, dim #1d3540 grid. All type monospace on a character grid. Numbers scramble through glyphs for 6 to 10 frames then lock to the true value. Target brackets lock in three steps with a tick. Thin 1.5px lines, no bloom, no glitch tearing, every label readable at 1080p.

## Watercolour & ink

Brush strokes paint themselves on textured paper. Washes bleed past the lines.

**Good for:** Storytelling, Travel and nature, Cultural brands

**Suggested stack:** Canvas brush engine or p5.js + p5.brush

**Palette:** #f4efe6, #2f3e46, #bc4749, #6a994e, #a7c4d2

**Rules**

- Everything is painted with strokes. No plain vector shapes.
- Washes reveal over 15 to 25 frames and bleed 4 to 8px past the ink line.
- Paper texture is always visible; pure white and pure black never appear.
- Linework re-randomises 12 times a second from a seed, so it lives without flickering.

**Avoid:** Perfect geometric shapes, digital gradients, text labels on everything

**Original style prompt**

Style: watercolour and ink on paper. Warm paper #f4efe6 with visible grain, ink #2f3e46, washes in #bc4749, #6a994e, #a7c4d2. Paint every element with brush strokes, never plain shapes. Washes spread over 15 to 25 frames and bleed slightly past the ink. Linework wobbles on twos (re-seeded 12 times per second from a fixed seed). No pure white, no pure black, very little text.

## Risograph & halftone print

Two or three spot inks overprinted on warm paper, halftone dots, plates slightly out of register.

**Good for:** Indie brands, Zines, Event posters

**Suggested stack:** Canvas 2D or a WebGL print shader

**Palette:** #f3ede2, #ff48b0, #0078bf, #ffe800

**Rules**

- Two or three inks only. Where inks overlap they multiply.
- Each plate is offset 2 to 4px from the others and stays there.
- Tones are halftone dots, no smooth gradients.
- Motion steps at 12fps for a printed, hand-pulled feel.

**Avoid:** A fourth ink, perfect registration, glossy highlights

**Original style prompt**

Style: risograph print. Warm paper #f3ede2. Two spot inks, fluorescent pink #ff48b0 and blue #0078bf (optional yellow #ffe800), overprinted with multiply blending. Each ink plate is misregistered 2 to 4px and stays offset. All tones are halftone dots, never smooth gradients. Animation steps at 12fps while the camera stays smooth.

## Paper cut-out & collage

Layered card and photo cut-outs with white scissor edges, moving in stop-motion steps.

**Good for:** Music and fashion, Kids stories, Editorial pieces

**Suggested stack:** Canvas or DOM layers with drop shadows between them

**Palette:** #e9e3d5, #1b1b1b, #e76f51, #2a9d8f, #f4a261

**Rules**

- Every piece has a white or cut edge and a small hard shadow on the layer below.
- Pieces move in stop-motion steps at 12fps; the camera can move at 24.
- Depth comes from 3 to 6 parallax layers.
- Joints pivot like split pins, they do not bend.

**Avoid:** Soft blurred shadows, smooth 60fps character motion, vector-perfect edges

**Original style prompt**

Style: paper cut-out collage. Card colours #e9e3d5, #e76f51, #2a9d8f, #f4a261 with black #1b1b1b details. Every piece has a slightly rough white cut edge and a small hard shadow on the layer below. Characters move in stop-motion steps at 12fps with split-pin joints; the camera drifts smoothly across 3 to 6 parallax layers.

## Hand-drawn line boil

Cartoon linework that wiggles every two frames, smears on fast moves, and looks drawn by hand.

**Good for:** Character shorts, Playful brands, Social clips

**Suggested stack:** Canvas 2D variable-width strokes with 3 jitter variants

**Palette:** #fffaf0, #1c1c1c, #ff595e, #1982c4, #ffca3a

**Rules**

- Animate on twos: the drawing changes every 2 frames at 24fps.
- Cycle 3 jitter variants of every line so it boils without strobing.
- Fast moves get a smear frame instead of motion blur.
- Anticipation before every big action: a small move the other way for 4 to 6 frames.

**Avoid:** Tweened vector motion at 60fps, perfect circles, text standing in for acting

**Original style prompt**

Style: hand-drawn cartoon with line boil. Off-white #fffaf0, ink #1c1c1c, flat fills #ff595e, #1982c4, #ffca3a. 24fps animated on twos. Every line has 3 jitter variants cycled so it boils. Fast moves use a smear frame, every big action gets 4 to 6 frames of anticipation, faces act. Variable-width ink lines, no perfect geometric shapes, almost no text.

## Pixel art & retro game

Big pixels, a limited palette, sprite cycles and chiptune timing.

**Good for:** Game trailers, Nostalgia marketing, Year-in-review

**Suggested stack:** Canvas at 320x180, scaled up with nearest-neighbour

**Palette:** #1a1c2c, #5d275d, #b13e53, #ef7d57, #ffcd75, #a7f070, #38b764, #41a6f6

**Rules**

- Draw at 320x180 and scale by 6 with image smoothing off. Never draw at full resolution.
- One fixed palette of 16 to 32 colours. Shading uses dithering, not blending.
- Sprites animate at 8 to 12fps; the camera snaps to whole pixels.
- Text uses a pixel font and types out in dialogue boxes.

**Avoid:** Mixed pixel sizes, blurry scaling, anti-aliased edges, smooth sub-pixel motion

**Original style prompt**

Style: 16-bit pixel art. Render to a 320x180 canvas and scale 6x with imageSmoothingEnabled = false. Use one fixed palette (#1a1c2c, #5d275d, #b13e53, #ef7d57, #ffcd75, #a7f070, #38b764, #41a6f6 plus greys). Shading by dithering only. Sprites animate at 8 to 12fps, camera moves in whole pixels, dialogue in a pixel font that types out in a bordered box.

## VHS, film & CRT eras

The texture of old media: grain, gate weave, scanlines, colour bleed, tracking lines.

**Good for:** Music videos, Throwback campaigns, Mystery teasers

**Suggested stack:** Canvas or Three.js scene plus a WebGL post-processing pass

**Palette:** #120f1d, #ff3fa4, #00e5ff, #ffd166

**Rules**

- Pick one era and commit: 1920s film, 1980s VHS, or 1990s camcorder.
- Texture is seeded per frame index, so grain changes every frame but renders the same every time.
- Gate weave of about 1px and brightness flicker of about 5% for film. Chroma shift of 2 to 3px for tape.
- Keep it legible: the effect sits on top of a clear composition, it is not the composition.

**Avoid:** Stacking every retro effect at once, glitch tearing over important text

**Original style prompt**

Style: 1980s VHS tape. Scene in deep #120f1d with neon accents #ff3fa4, #00e5ff and warm #ffd166. Post pass: scanlines, 2 to 3px chroma shift, slight tape noise and an occasional tracking line, all seeded by frame index so the render is deterministic. A chrome title moment. Keep the composition clear underneath; the tape texture never covers key text.

## Toy & material 3D

Soft studio-lit 3D objects that look like toys, clay or candy, with shallow depth of field.

**Good for:** Product films, Brand idents, Playful explainers

**Suggested stack:** Three.js with physical materials and an environment map

**Palette:** #f6e6e4, #ff8fab, #7bdff2, #b2f7ef, #fcbf49

**Rules**

- Soft studio light from one big key and a fill. Matte or soft-gloss materials.
- Shallow depth of field keeps attention on one object.
- Objects arrive with weight: fast in, 2 small settles, no floating.
- Fixed random seed for every procedural shape.

**Avoid:** Chrome everything, hard black shadows, objects floating with no contact shadow

**Original style prompt**

Style: toy-like 3D. Three.js, soft studio lighting with one large key and a fill, pastel background #f6e6e4, matte and soft-gloss materials in #ff8fab, #7bdff2, #b2f7ef, #fcbf49. Shallow depth of field on the hero object. Objects land with weight and two small settles, always with a contact shadow. Fixed seeds for any procedural geometry.

## Vertical social captions

Bold captions pop on every phrase, built for sound-off viewing in a 9:16 frame.

**Good for:** Reels, Shorts, TikTok, Founder clips, Tips and listicles

**Suggested stack:** HTML + CSS text, Canvas for backgrounds

**Palette:** #000000, #ffffff, #ffe600, #ff2e63

**Rules**

- 1080x1920. Keep everything inside the middle 80% so platform buttons do not cover it.
- Captions of 1 to 4 words, each popping in on its spoken beat with a 6 frame scale overshoot.
- The first second must hook with the sound off.
- Highlight one word per caption in the accent colour.

**Avoid:** Long sentences on screen, text in the bottom 15%, small type

**Original style prompt**

Style: vertical social captions. 1080x1920, all content inside the middle 80% of the frame. Black #000 and white #fff with yellow #ffe600 for the one highlighted word per caption and pink #ff2e63 for emphasis stamps. Captions are 1 to 4 words, chunky with a thick outline, popping in on each beat with a 6 frame scale overshoot. The first second must work with the sound off.
