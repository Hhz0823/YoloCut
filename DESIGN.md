# YoloCut macOS Vibrancy Design System

`style_slug: macos-vibrancy`

## 1. Visual Theme & Atmosphere

YoloCut uses a restrained, native-desktop interface inspired by macOS Vibrancy
and Liquid Glass. Depth comes from three graphite surfaces, optically refracted
ownership bars, hairline separators, typography, and spacing. The product must
feel calm during long editing sessions: refraction is selective and never turns
every card into glass or competes with the edit canvas.

The design contract applies to application chrome: dashboard, editor panels,
timeline controls, Agent chat, inspector, settings, dialogs, menus, empty,
loading, and error states. User-authored video, imported thumbnails, rendered
templates, scopes, and canvas previews retain their source appearance.

## 2. Color

| Role | Token | Value |
| --- | --- | --- |
| Deepest / sidebar / input well | `--cc-bg`, `--cc-inset` | `#1c1c1e` |
| Main panel | `--cc-panel` | `#2c2c2e` |
| Raised / selected surface | `--cc-panel-alt` | `#3a3a3c` |
| Hover | `--cc-hover` | `rgba(255,255,255,.08)` |
| Hairline border | `--cc-border` | `rgba(255,255,255,.08)` |
| Strong hairline border | `--cc-border-light` | `rgba(255,255,255,.12)` |
| Primary text | `--cc-text`, `--cc-text-strong` | `rgba(255,255,255,.95)` |
| Secondary text | `--cc-text-muted` | `rgba(255,255,255,.72)` |
| Tertiary text | `--cc-text-dim` | `rgba(255,255,255,.52)` |
| Interactive highlight | `--cc-accent` | `#0a84ff` |
| Success | `--cc-success` | `#30d158` |
| Warning | `--cc-gold` | `#ff9f0a` |
| Destructive | `--cc-danger` | `#ff453a` |

Bright semantic colors appear as text, icons, focus indicators, progress, and
small status marks. They do not become large button, card, banner, or panel
backgrounds. State must never be communicated through color alone.

Glass typography uses adaptive monochrome ink. A light sampled surface uses
near-black text; a dark sampled surface uses near-white text; an explicitly
mixed image or gradient surface uses a tightly scoped black-to-white text
gradient. Icons retain a solid high-contrast ink so their shape never vanishes.

## 3. Typography

- Headings and product titles: `Georgia, "Times New Roman", serif`, semibold.
- Body and controls: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Code, paths, timecode, and numeric telemetry: `"SF Mono", Menlo, Consolas,
  ui-monospace, monospace` with tabular figures.
- Primary text uses 95% white; secondary text uses at least 70% white for body
  copy. Tertiary text is limited to metadata and nonessential hints.
- Dense editor labels may remain 11-13px; touch-oriented and responsive controls
  must retain a 44px target even when the visible glyph is smaller.

## 4. Spacing & Grid

- Base gap: 16px; compact tool clusters: 8px; dense timeline controls: 4-8px.
- Dashboard container: `24px` desktop, `16px` compact.
- Cards and dialogs: `16px`, increasing to `24px` when space allows.
- Marketing-style section rhythm, when present: `48px` / `64px` responsive.
- Maximum corner radius: 12px. Containers use 12px; controls use 8px.
- Borders are always one CSS pixel. Fractional legacy separators are upgraded
  to the same visible one-pixel hairline system.

## 5. Layout & Composition

The editor keeps its functional multi-panel composition. Surface depth maps to
ownership:

1. Sidebar and app void: deepest translucent surface with Liquid Glass edge
   refraction when supported, or `backdrop-filter` fallback otherwise.
2. Working panels and timeline: main surface.
3. Selected rows, raised controls, menus, cards, and focused working groups:
   lightest surface.

Panels are separated by hairlines rather than shadow. Dashboard content remains
constrained to 1120px. On narrow windows, toolbars wrap or collapse without
horizontal overflow; no layout-changing hover state is allowed.

## 6. Components

- Buttons: 8px radius, lightest graphite fill or transparent secondary style,
  1px border, 200ms color transition. Blue is text/icon/focus only.
- Cards: main graphite surface, 1px white/8 border, 12px radius, no shadow.
- Inputs and code blocks: deepest surface, 1px white/10 border, 8px radius.
- Sidebar/titlebar/compact ownership header: `liquid-glass-react` standard-mode
  refraction, 12px maximum radius, static pointer input, and 1px edge. Economy
  hardware, reduced-motion, and unsupported browsers receive a CSS blur fallback
  without loading the refraction bundle.
- Active navigation: white/10 surface and primary text; no accent stripe.
- Dialogs and menus: main or raised graphite, 12px radius, hairline border, no
  large drop shadow.
- Empty/loading/error states reuse the same surfaces, spacing, typography, and
  semantic icon plus text. Loading may use determinate progress or static status
  copy, never pulse, bounce, or spin.

## 7. Motion & Interaction

- Only color and opacity transition: `200ms ease-out`; Liquid Glass refraction
  remains static and receives no elastic pointer deformation.
- Hover: white/5 to white/8 surface change; no translation or scaling.
- Pressed: `opacity: .8`.
- Keyboard focus: 2px blue outline/ring with sufficient contrast.
- No pulse, bounce, spin, spring, elastic, glow, or layout-moving animation in
  application chrome.
- `prefers-reduced-motion: reduce` makes remaining transitions immediate.

## 8. Voice & Brand

The product name is YoloCut. Copy is direct, calm, and operational: say what
happened, what the user can do, and whether data changed. Avoid hype, exclamation
marks, vague AI claims, and playful error language. Preserve YoloCut only
when referring to upstream attribution or legacy protocol compatibility.

## 9. Anti-patterns

- No decorative CSS gradients. The only exceptions are the optical edge layers
  generated inside `liquid-glass-react` and adaptive mixed-background text ink.
- No glow and no shadow larger than the permitted 2px focus spread.
- No decorative CSS animation.
- No pill containers, `rounded-full`, or radius above 12px. Native traffic-light
  controls, radio dots, color swatches, and timeline geometry are functional
  shape exceptions, not container styling.
- No bright accent-colored button, banner, card, or panel backgrounds.
- No border thicker than 1px; focus uses outline rather than a thick border.
- No left/right accent stripe on selected navigation.
- No nested decorative cards, hover lift, scale, or generic glassmorphism on
  every surface. Vibrancy is reserved for ownership-defining sidebars.
- Do not restyle user-authored media or rendered template content to match the
  application chrome.
- Do not mount Liquid Glass on repeated project/media cards or over the edit
  canvas. It is reserved for titlebars, the primary tool rail, and compact
  ownership headers so GPU/CPU budget remains available for video work.
