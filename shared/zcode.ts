/** Browser-safe ZCode discovery result. Never add credentials to this shape. */
export interface ZCodePublicStatus {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly running: boolean;
  readonly authenticated: boolean;
  readonly keyAvailable: boolean;
  readonly port: number | null;
  readonly baseUrl: string | null;
  readonly version: string | null;
  readonly models: readonly string[];
  readonly message: string;
}
