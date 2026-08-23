# YoloCut macOS Vibrancy design contract

## Goal and target

- Target artifact: YoloCut desktop dashboard, editor shell, panels, dialogs,
  menus, controls, and application states.
- Audience: creators editing long-form and 4K video on Windows and macOS, plus
  keyboard-driven operators using Agent workflows.
- Goal: make the existing application read immediately as restrained native
  macOS dark vibrancy without changing editor behavior or project data.

## Evidence

| Evidence | Confidence | Use |
| --- | --- | --- |
| User-provided `macos-vibrancy` specification and hard prompt | provided | Binding palette, depth, type, radius, border, interaction, and forbidden rules |
| Official `rdev/liquid-glass-react` README, source, package metadata, and MIT license | observed | Standard-mode component API, compatibility boundary, pinned version, and attribution |
| Existing React components, `src/index.css`, theme tokens, and skin engine | observed | Implementation boundary and current-state audit |
| Existing dashboard/editor structure and Agent/timeline workflows | observed | Functional layout that must remain intact |
| Windows should receive the same visual material through CSS backdrop blur | inferred | Cross-platform fallback; not a claim of native AppKit vibrancy |

No reference screenshot or proprietary macOS asset was supplied.

## Reference boundaries

| Reference | Keep | Change | Do not copy |
| --- | --- | --- | --- |
| macOS Vibrancy style reference | Three graphite depths, restrained blur, hairlines, serif headings, system body, quiet interaction | Tailwind examples become existing CSS variables and React styles; content and labels stay YoloCut-specific | Apple trademarks, exact Settings layouts, proprietary icons, native assets, or claims that the web surface is AppKit |
| Existing YoloCut UI | Editor layout, timeline density, keyboard workflows, panels, states, localization, data and Agent behavior | Orange default accent, Geist UI font, large shadows, decorative gradients, inconsistent radii and separators | No wholesale rewrite and no replacement of established editing controls with a mockup |

## Final design stance

YoloCut becomes a graphite desktop workstation with selective liquid refraction:
translucent ownership bars, solid working panels, restrained raised controls,
one blue interactive highlight, adaptive monochrome ink, and typography-led
hierarchy. The interface remains dense where editing demands density, but every
high-frequency control shares a calm 1px/8px/12px component vocabulary.

## Decisions and conflict resolution

- The user's concise request and forbidden list outrank contradictory examples
  in the pasted reference. Therefore `bg-blue-600` is not used as a large
  background even though it appears once in the reference token dictionary.
- The style contract governs application chrome. User videos, thumbnails,
  motion-graphic templates, and canvas previews may contain gradients, glow, or
  animation because they are edited content rather than product decoration.
- Existing alternate skins remain a compatibility feature; macOS Vibrancy is
  the default and acceptance target. Removing user-selectable skins is outside
  this change.
- The newer request explicitly permits optical gradients for liquid refraction
  and mixed-background text. This narrowly supersedes the earlier blanket
  gradient ban; ordinary backgrounds, buttons, cards, and headings remain solid.
- Use `liquid-glass-react@1.1.1` in stable `standard` mode. Do not use `shader`
  mode in production because the upstream documentation calls it less stable.

## Risks and unknowns

- `backdrop-filter` depends on OS/compositor support; the fallback is the same
  deepest solid graphite surface.
- Dense timeline semantics use multiple clip colors for fast recognition. They
  remain content/status colors while surrounding chrome follows the three-depth
  palette.
- Exact visual tuning on macOS hardware is unverified in this Windows workspace.
- Safari and Firefox only partially support upstream displacement, so they use
  the same readable blur surface without claiming full refraction fidelity.

## Quality gate

- [x] Default skin exposes exactly the three graphite surface levels.
- [x] UI chrome has no decorative gradient, glow, large shadow, or animation.
- [x] Headings use Georgia; body uses the system UI stack; code uses SF Mono fallbacks.
- [x] Sidebar, main panel, raised surface, controls, cards, and dialogs map to documented roles.
- [x] Borders are 1px, container radius is at most 12px, and active navigation has no accent stripe.
- [x] Buttons, inputs, empty/loading/error states share hover, active, and focus behavior.
- [x] Keyboard focus is visible; reduced motion and responsive overflow are covered.
- [x] Build, component regressions, style contract verification, and a visual smoke review pass.
- [x] Liquid Glass runtime, adaptive monochrome ink, mixed-background gradient ink, and economy fallback pass automated and rendered checks.
