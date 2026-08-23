import {
  EMPTY_LOCAL_VOICE_CAPABILITIES,
  installedLocalVoiceModels,
  localVoiceSelectionIssue,
  parseLocalVoiceCapabilities,
  type LocalVoiceCapabilitySnapshot,
  type LocalVoiceSelection,
} from '../../shared/local-voice';

let liveLocalVoiceCapabilities: LocalVoiceCapabilitySnapshot = EMPTY_LOCAL_VOICE_CAPABILITIES;

/** Install a fresh backend snapshot. Invalid or missing payloads deliberately clear availability. */
export function applyLiveLocalVoiceCapabilities(value: unknown): void {
  liveLocalVoiceCapabilities = parseLocalVoiceCapabilities(value);
}

export function currentLocalVoiceCapabilities(): LocalVoiceCapabilitySnapshot {
  return liveLocalVoiceCapabilities;
}

export function availableLocalVoiceModels() {
  return installedLocalVoiceModels(liveLocalVoiceCapabilities);
}

export function assertAvailableLocalVoiceSelection(selection: LocalVoiceSelection): void {
  const issue = localVoiceSelectionIssue(liveLocalVoiceCapabilities, selection);
  if (issue) throw new Error(issue);
}
