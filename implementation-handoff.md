# YoloCut macOS Vibrancy implementation handoff

Read `DESIGN.md` and `design-contract.md` before changing UI code.

- Keep the React/Vite/Electron stack and existing layout behavior.
- Implement through `src/skins.ts`, final imported `src/macos-vibrancy.css` and
  `src/liquid-glass.css`, `src/ui/LiquidGlassBackdrop.tsx`, and semantic class
  names on high-frequency shells.
- Surfaces: `#1c1c1e` → `#2c2c2e` → `#3a3a3c`; borders white/8-12; accent
  `#0a84ff` for text, icons, focus, and compact progress only.
- Type: Georgia headings, system UI body, SF Mono/Menlo/Consolas code.
- Controls: 8px radius; cards/dialogs: 12px; borders: 1px; color transitions:
  200ms ease-out; pressed opacity: .8.
- Do not add decorative gradients, glow, large shadows, pill containers,
  accent-filled large surfaces, hover movement, or thick borders. The scoped
  exceptions are upstream optical refraction and mixed-background text ink.
- Pin `liquid-glass-react` to `1.1.1`, use `standard` mode, static pointer input,
  `cornerRadius={12}`, and never apply it to repeated cards or authored media.
- Glass ink is adaptive: light → black, dark → white, mixed → monochrome
  gradient. Economy/reduced-motion/unsupported environments use CSS fallback
  and must not load the lazily split refraction module.
- Preserve all video, timeline, Agent, project, export, and localization logic.
- Do not apply chrome restrictions to user-authored media and rendered previews.
- Responsive gate: no horizontal overflow; maintain 44px hit areas on compact
  touch layouts and clear keyboard focus everywhere.

The first artifact must prove the dashboard, editor shell, sidebar, Agent chat,
inspector, settings dialog, buttons, cards, inputs, empty/loading/error states,
and reduced-motion behavior all use one coherent system.
