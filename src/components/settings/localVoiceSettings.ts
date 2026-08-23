import type { SettingsField } from './settingsFields';

export const LOCAL_VOICE_MODEL_FIELD = {
  name: 'LOCAL_VOICE_MODEL',
  label: '默认模型',
  kind: 'select',
  defaultLabel: '自动（首个已安装模型）',
} as const satisfies SettingsField;

export const LOCAL_VOICE_ID_FIELD = {
  name: 'LOCAL_VOICE_ID',
  label: '默认音色',
  kind: 'select',
  defaultLabel: '模型推荐音色',
} as const satisfies SettingsField;

export const LOCAL_VOICE_LANGUAGE_FIELD = {
  name: 'LOCAL_VOICE_LANGUAGE',
  label: '默认语言',
  kind: 'select',
  defaultLabel: '模型推荐语言',
} as const satisfies SettingsField;

export const LOCAL_VOICE_SPEED_FIELD = {
  name: 'LOCAL_VOICE_SPEED',
  label: '默认语速',
  kind: 'select',
  defaultLabel: '1.00×',
} as const satisfies SettingsField;

export const LOCAL_VOICE_DEVICE_FIELD = {
  name: 'LOCAL_VOICE_DEVICE',
  label: '执行设备',
  kind: 'select',
  defaultLabel: '自动（按模型与显存）',
} as const satisfies SettingsField;

export const LOCAL_VOICE_SETTINGS_FIELDS = [
  LOCAL_VOICE_MODEL_FIELD,
  LOCAL_VOICE_ID_FIELD,
  LOCAL_VOICE_LANGUAGE_FIELD,
  LOCAL_VOICE_SPEED_FIELD,
  LOCAL_VOICE_DEVICE_FIELD,
] as const satisfies readonly SettingsField[];

export function localVoiceSettingsSupported(models: Record<string, string> | undefined): boolean {
  if (!models) return false;
  return LOCAL_VOICE_SETTINGS_FIELDS.every((field) => Object.hasOwn(models, field.name));
}
