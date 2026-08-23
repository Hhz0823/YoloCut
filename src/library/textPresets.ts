export interface TextClipPreset {
  name: string;
  text: string;
  fontSize: number;
  fontWeight: number;
  align: 'left' | 'center' | 'right';
}

interface TextPresetDefinition {
  id: 'title' | 'subtitle' | 'body';
  label: string;
  placeholder: string;
  description: string;
  clip: Omit<TextClipPreset, 'name' | 'text'>;
}

export const TEXT_PRESETS: readonly TextPresetDefinition[] = [
  {
    id: 'title',
    label: '标题',
    placeholder: '输入标题',
    description: '醒目的主标题，适合片头与章节卡。',
    clip: { fontSize: 96, fontWeight: 750, align: 'center' },
  },
  {
    id: 'subtitle',
    label: '副标题',
    placeholder: '输入副标题',
    description: '信息层级更轻，适合补充说明。',
    clip: { fontSize: 56, fontWeight: 600, align: 'center' },
  },
  {
    id: 'body',
    label: '说明文字',
    placeholder: '输入说明文字',
    description: '左对齐说明，适合要点与注释。',
    clip: { fontSize: 40, fontWeight: 500, align: 'left' },
  },
] as const;
