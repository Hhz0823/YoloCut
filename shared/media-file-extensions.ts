/** Video containers accepted by the native FFmpeg compatibility pipeline.
 * Keep this independent of browser MIME reporting: Windows often exposes MXF,
 * MTS and legacy camera files as application/octet-stream. */
export const VIDEO_FILE_EXTENSIONS = [
  '.mp4', '.m4v', '.mov', '.qt', '.webm', '.mkv', '.avi',
  '.mpeg', '.mpg', '.mpe', '.m2v', '.ts', '.mts', '.m2ts', '.vob',
  '.mxf', '.wmv', '.asf', '.flv', '.f4v', '.3gp', '.3g2', '.ogv',
  '.dv', '.rm', '.rmvb',
] as const;

export const VIDEO_FILE_EXTENSION_SET: ReadonlySet<string> = new Set(VIDEO_FILE_EXTENSIONS);

export const VIDEO_FILE_PICKER_ACCEPT = `video/*,${VIDEO_FILE_EXTENSIONS.join(',')}`;

export const VIDEO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.qt': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mpe': 'video/mpeg',
  '.m2v': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.vob': 'video/mpeg',
  '.mxf': 'application/mxf',
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.flv': 'video/x-flv',
  '.f4v': 'video/mp4',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.ogv': 'video/ogg',
  '.dv': 'video/dv',
  '.rm': 'application/vnd.rn-realmedia',
  '.rmvb': 'application/vnd.rn-realmedia-vbr',
};

export const VIDEO_EXTENSION_BY_MIME: Readonly<Record<string, string>> = Object.freeze(
  Object.entries(VIDEO_MIME_BY_EXTENSION).reduce<Record<string, string>>((result, [extension, mime]) => {
    result[mime] ??= extension;
    return result;
  }, {}),
);

function extensionOf(value: string): string {
  const clean = value.split(/[?#]/, 1)[0]!.replaceAll('\\', '/').toLowerCase();
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

export function isVideoFileName(value: string): boolean {
  return VIDEO_FILE_EXTENSION_SET.has(extensionOf(value));
}

export function videoMimeForFileName(value: string): string | undefined {
  return VIDEO_MIME_BY_EXTENSION[extensionOf(value)];
}
