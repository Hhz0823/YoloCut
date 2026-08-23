import type { CSSProperties } from 'react';
import { theme } from '../../theme';

export const newCard: CSSProperties = {
  width: '100%', aspectRatio: '16 / 9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: `1px dashed ${theme.borderLight}`, borderRadius: 12, background: theme.panel, cursor: 'pointer',
};
export const card: CSSProperties = { border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.panel, overflow: 'hidden' };
export const thumb: CSSProperties = {
  width: '100%', aspectRatio: '16 / 9', background: theme.bg, border: 'none', borderBottom: `1px solid ${theme.border}`,
  position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center', cursor: 'pointer',
};
export const nameInput: CSSProperties = { font: 'inherit', fontSize: 13, fontWeight: 550, background: theme.bg, color: theme.text, border: `1px solid ${theme.borderLight}`, borderRadius: 8, padding: '4px 8px', width: '100%' };
export const miniBtn: CSSProperties = { background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', fontSize: 12, padding: '4px 6px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
export const settingsBtn: CSSProperties = { background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', padding: 6, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
export const modelSetupCard: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '16px',
  border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.panel,
};
export const modelSetupIcon: CSSProperties = {
  width: 34, height: 34, flex: '0 0 auto', display: 'grid', placeItems: 'center',
  borderRadius: 8, color: theme.accent, background: theme.panelAlt,
};
export const modelSetupButton: CSSProperties = {
  flex: '0 0 auto', border: `1px solid ${theme.borderLight}`, borderRadius: 8,
  background: theme.panelAlt, color: theme.textStrong, padding: '8px 12px',
  fontSize: 12, fontWeight: 650, cursor: 'pointer',
};
export const importBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: theme.text,
  background: theme.panelAlt, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
};
export const searchBox: CSSProperties = { width: 216, position: 'relative', display: 'inline-flex', alignItems: 'center' };
export const searchIcon: CSSProperties = { position: 'absolute', left: 9, display: 'inline-flex', color: theme.textDim, pointerEvents: 'none' };
export const searchInput: CSSProperties = {
  width: '100%', height: 32, boxSizing: 'border-box', padding: '0 30px 0 28px',
  border: `1px solid ${theme.border}`, borderRadius: 8, background: theme.bg, color: theme.text,
  fontSize: 12, WebkitAppearance: 'none',
};
export const searchClear: CSSProperties = {
  position: 'absolute', right: 2, width: 24, height: 24, display: 'grid', placeItems: 'center',
  padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: theme.textDim, cursor: 'pointer',
};
export const searchEmpty: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, marginTop: 16, color: theme.textDim, fontSize: 12 };
