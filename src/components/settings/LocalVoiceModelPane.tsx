import { useT } from '../../i18n/locale';
import { Icon } from '../icons';
import { LocalModelPackPane } from './LocalModelPackPane';
import type { FieldCtx } from './settingsVendorPane';
import { modelValue } from './settingsSchema';
import {
  installedLocalVoiceModels,
  localVoiceModelPack,
  localVoiceModels,
  preferenceVoiceModel,
  voicesForLanguage,
  type LocalVoiceModelPack,
  type VoiceExecutionDevice,
  type VoiceLanguageSupport,
} from './localVoiceModel';
import {
  LOCAL_VOICE_DEVICE_FIELD,
  LOCAL_VOICE_ID_FIELD,
  LOCAL_VOICE_LANGUAGE_FIELD,
  LOCAL_VOICE_MODEL_FIELD,
  LOCAL_VOICE_SPEED_FIELD,
  localVoiceSettingsSupported,
} from './localVoiceSettings';
import './LocalVoiceModelPane.css';

const DEVICE_OPTIONS: readonly { value: VoiceExecutionDevice; label: string }[] = [
  { value: 'auto', label: '自动（按模型与显存）' },
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'cuda', label: 'CUDA（s2.cpp）' },
  { value: 'cpu', label: 'CPU' },
];

function effectiveValue(ctx: FieldCtx, name: string): string {
  return ctx.values[name] ?? modelValue(ctx.status, name);
}

function languageSupportLabel(support: VoiceLanguageSupport | undefined): string | null {
  if (support === 'partial') return '部分支持';
  if (support === 'experimental') return '实验支持';
  return support === 'full' ? '完整支持' : null;
}

function VoiceRuntimeStatus({ model }: { model: LocalVoiceModelPack }) {
  const t = useT();
  const backend = model.runtimeStatus.backend;
  const backendLabel = backend === 'webgpu'
    ? 'WebGPU'
    : backend === 'cuda-hybrid'
      ? 'CUDA 混合卸载'
      : backend === 'cpu' ? 'CPU' : '尚无运行记录';
  const fallbackReason = model.runtimeStatus.fallbackReason
    ?? (backend ? '无回退' : '尚无运行记录');
  return (
    <div className="cc-local-voice-runtime-status" role="status" aria-live="polite">
      <div className="cc-local-voice-runtime-row">
        <span>{t('实际 backend')}</span>
        <strong>{t(backendLabel)}</strong>
      </div>
      <div className="cc-local-voice-runtime-row">
        <span>{t('fallbackReason')}</span>
        <span>{fallbackReason === '无回退' || fallbackReason === '尚无运行记录' ? t(fallbackReason) : fallbackReason}</span>
      </div>
      <p>{t('实际 backend 与 fallbackReason 由后端运行结果提供，不根据设备偏好推断。')}</p>
    </div>
  );
}

function VoicePackMetadata({ model }: { model: LocalVoiceModelPack }) {
  const t = useT();
  return (
    <div className="cc-local-voice-meta">
      <div className="cc-local-voice-chip-row">
        {model.runtime && <span className="cc-local-voice-chip">{t(model.runtime)}</span>}
        {model.releaseChannel === 'experimental' && <span className="cc-local-voice-chip" data-tone="warning">
          {t('实验组件')}
        </span>}
        {model.languages.map((language) => {
          const support = languageSupportLabel(language.support);
          return <span className="cc-local-voice-chip" key={language.id}>
            {t(language.label)}{support ? ` · ${t(support)}` : ''}
          </span>;
        })}
        {model.languages.length === 0 && <span className="cc-local-voice-chip">{t('目录未提供语言信息')}</span>}
      </div>
      <div className="cc-local-voice-compatibility" aria-label={t('硬件兼容性')}>
        {model.hardware.compatibility.map((item) => (
          <span
            className="cc-local-voice-compat"
            data-status={item.status}
            key={`${item.label}:${item.status}`}
          >
            {item.status === 'verified' || item.status === 'supported' ? '✓' : '•'}
            {t(item.label)}
          </span>
        ))}
        {model.hardware.cpuFallback && <span className="cc-local-voice-compat" data-status="supported">
          ✓ {t('CPU 回退')}
        </span>}
      </div>
      <VoiceRuntimeStatus model={model} />
    </div>
  );
}

function VoiceCatalogEmpty() {
  const t = useT();
  return (
    <div className="cc-local-voice-empty" role="status">
      <Icon name="volume" size={20} />
      <strong>{t('目录中暂无本地口播模型')}</strong>
      <span>{t('请更新到包含 voice 类型模型包的后端目录；前端不会内置模型地址或绕过目录下载。')}</span>
    </div>
  );
}

function supportedDevice(model: LocalVoiceModelPack, device: VoiceExecutionDevice): boolean {
  return model.hardware.devices.length === 0 || model.hardware.devices.includes(device);
}

function safeSpeed(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2 ? parsed : fallback;
}

function safeDevice(value: string, fallback: VoiceExecutionDevice): VoiceExecutionDevice {
  return value === 'auto' || value === 'webgpu' || value === 'cuda' || value === 'cpu' ? value : fallback;
}

function VoicePreferences({ models, ctx }: { models: readonly LocalVoiceModelPack[]; ctx: FieldCtx }) {
  const t = useT();
  const settingsSupported = localVoiceSettingsSupported(ctx.status?.models);
  const installed = installedLocalVoiceModels(models);
  const configuredModelId = effectiveValue(ctx, LOCAL_VOICE_MODEL_FIELD.name);
  const selectedModel = preferenceVoiceModel(models, configuredModelId);
  const configuredUnavailable = Boolean(configuredModelId && !selectedModel);
  const language = effectiveValue(ctx, LOCAL_VOICE_LANGUAGE_FIELD.name)
    || selectedModel?.defaults.language
    || selectedModel?.languages[0]?.id
    || '';
  const availableVoices = voicesForLanguage(selectedModel, language);
  const configuredVoice = effectiveValue(ctx, LOCAL_VOICE_ID_FIELD.name);
  const voice = availableVoices.some((option) => option.id === configuredVoice)
    ? configuredVoice
    : selectedModel?.defaults.voice && availableVoices.some((option) => option.id === selectedModel.defaults.voice)
      ? selectedModel.defaults.voice
      : availableVoices[0]?.id ?? '';
  const speed = safeSpeed(
    effectiveValue(ctx, LOCAL_VOICE_SPEED_FIELD.name),
    selectedModel?.defaults.speed ?? 1,
  );
  const savedDevice = safeDevice(
    effectiveValue(ctx, LOCAL_VOICE_DEVICE_FIELD.name),
    selectedModel?.defaults.device ?? 'auto',
  );
  const device = selectedModel && !supportedDevice(selectedModel, savedDevice)
    ? selectedModel.defaults.device
    : savedDevice;
  const controlsReady = settingsSupported && Boolean(selectedModel);

  return (
    <section className="cc-local-voice-preferences" aria-labelledby="local-voice-preferences-heading">
      <header>
        <div>
          <h3 id="local-voice-preferences-heading">{t('口播默认设置')}</h3>
          <p>{t('这些选项只决定本地口播偏好；实际 backend 与 fallbackReason 以每次后端运行结果为准。')}</p>
        </div>
      </header>
      {!settingsSupported && <div className="cc-local-voice-settings-status" role="alert">
        {t('当前后端尚未开放本地口播设置保存；安装状态可查看，配置项保持只读。')}
      </div>}
      {settingsSupported && installed.length === 0 && <div className="cc-local-voice-settings-status" role="status">
        {t('安装至少一个本地口播模型后，才能选择默认模型、音色与执行设备。')}
      </div>}
      {settingsSupported && configuredUnavailable && <div className="cc-local-voice-settings-status" role="alert">
        {t('已保存的默认模型当前未安装，请选择一个已安装模型。')}
      </div>}
      <div className="cc-local-voice-form">
        <label className="cc-local-voice-field">
          <span>{t(LOCAL_VOICE_MODEL_FIELD.label)}</span>
          <select
            value={configuredModelId}
            disabled={!settingsSupported || installed.length === 0}
            onChange={(event) => ctx.onStage(LOCAL_VOICE_MODEL_FIELD, event.target.value)}
          >
            <option value="">{t('自动（首个已安装模型）')}</option>
            {configuredModelId && !models.some((model) => model.modelId === configuredModelId) && (
              <option value={configuredModelId} disabled>{configuredModelId} · {t('不可用')}</option>
            )}
            {models.map((model) => (
              <option value={model.modelId} disabled={!model.usable} key={model.packId}>
                {t(model.label)}{model.status !== 'installed'
                  ? ` · ${t('未安装')}`
                  : !model.usable ? ` · ${t('运行组件不可用')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-local-voice-field">
          <span>{t(LOCAL_VOICE_LANGUAGE_FIELD.label)}</span>
          <select
            value={language}
            disabled={!controlsReady || !selectedModel?.languages.length}
            onChange={(event) => ctx.onStage(LOCAL_VOICE_LANGUAGE_FIELD, event.target.value)}
          >
            {!selectedModel?.languages.length && <option value="">{t('未提供可选语言')}</option>}
            {selectedModel?.languages.map((option) => (
              <option value={option.id} key={option.id}>{t(option.label)}</option>
            ))}
          </select>
        </label>
        <label className="cc-local-voice-field">
          <span>{t(LOCAL_VOICE_ID_FIELD.label)}</span>
          <select
            value={voice}
            disabled={!controlsReady || availableVoices.length === 0}
            onChange={(event) => ctx.onStage(LOCAL_VOICE_ID_FIELD, event.target.value)}
          >
            {availableVoices.length === 0 && <option value="">{t('未提供可选音色')}</option>}
            {availableVoices.map((option) => (
              <option value={option.id} key={option.id}>{t(option.label)}</option>
            ))}
          </select>
        </label>
        <label className="cc-local-voice-field">
          <span>{t(LOCAL_VOICE_DEVICE_FIELD.label)}</span>
          <select
            value={device}
            disabled={!controlsReady}
            onChange={(event) => ctx.onStage(LOCAL_VOICE_DEVICE_FIELD, event.target.value)}
          >
            {DEVICE_OPTIONS.map((option) => (
              <option
                value={option.value}
                disabled={selectedModel ? !supportedDevice(selectedModel, option.value) : false}
                key={option.value}
              >
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-local-voice-field">
          <span>{t(LOCAL_VOICE_SPEED_FIELD.label)}</span>
          <span className="cc-local-voice-speed">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={speed}
              disabled={!controlsReady || !selectedModel?.supportsSpeed}
              aria-label={t(LOCAL_VOICE_SPEED_FIELD.label)}
              onChange={(event) => ctx.onStage(LOCAL_VOICE_SPEED_FIELD, Number(event.target.value).toFixed(2))}
            />
            <output>{speed.toFixed(2)}×</output>
          </span>
        </label>
      </div>
    </section>
  );
}

export function LocalVoiceModelPane({ ctx }: { ctx: FieldCtx }) {
  return (
    <LocalModelPackPane
      title="可安装模型"
      description="模型信息与安装文件完全来自后端目录；安装后推理保持离线。"
      filter={(pack) => localVoiceModelPack(pack) !== null}
      emptyState={<VoiceCatalogEmpty />}
      renderExtraMetadata={(pack) => {
        const model = localVoiceModelPack(pack);
        return model ? <VoicePackMetadata model={model} /> : null;
      }}
      renderAfter={(packs) => {
        const models = localVoiceModels(packs);
        return models.length > 0 ? <VoicePreferences models={models} ctx={ctx} /> : null;
      }}
    />
  );
}
