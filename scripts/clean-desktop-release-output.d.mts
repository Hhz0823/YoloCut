export type DesktopReleaseTarget =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'win32-x64'
  | 'linux-x64';

export interface DesktopReleaseCleanupOptions {
  root: string;
  target: DesktopReleaseTarget;
  version: string;
}

export declare function cleanDesktopReleaseOutput(
  options: DesktopReleaseCleanupOptions,
): Promise<string[]>;
