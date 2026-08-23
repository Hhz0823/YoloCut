import { app, BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';

const files = [
  'vhs.frag',
  'zoom-blur.frag',
  'prism.frag',
  'ripple.frag',
  'night-vision.frag',
  'thermal.frag',
  'comic.frag',
  'emboss.frag',
  'old-film.frag',
  'liquid-glass.frag',
];
const shaders = files.map((name) => ({
  name,
  source: readFileSync(new URL(`../src/gl/fx/${name}`, import.meta.url), 'utf8'),
}));
const vertex = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

const timeout = setTimeout(() => {
  console.error('open-effects WebGL verification timed out');
  app.exit(2);
}, 30_000);
timeout.unref();

async function run() {
  try {
    await app.whenReady();
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadURL('data:text/html,<canvas id="gl" width="32" height="32"></canvas>');
    const result = await win.webContents.executeJavaScript(`(() => {
    const gl = document.getElementById('gl').getContext('webgl2');
    if (!gl) return { error: 'WebGL2 unavailable' };
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      const log = gl.getShaderInfoLog(shader) || '';
      return { shader, ok, log };
    };
    const vertex = compile(gl.VERTEX_SHADER, ${JSON.stringify(vertex)});
    if (!vertex.ok) return { error: 'vertex: ' + vertex.log };
    const failures = [];
    for (const entry of ${JSON.stringify(shaders)}) {
      const fragment = compile(gl.FRAGMENT_SHADER, entry.source);
      if (!fragment.ok) {
        failures.push(entry.name + ': ' + fragment.log);
        continue;
      }
      const program = gl.createProgram();
      gl.attachShader(program, vertex.shader);
      gl.attachShader(program, fragment.shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        failures.push(entry.name + ' link: ' + (gl.getProgramInfoLog(program) || 'unknown'));
      }
      gl.deleteProgram(program);
      gl.deleteShader(fragment.shader);
    }
    gl.deleteShader(vertex.shader);
    return { failures };
  })()`);
    if (result.error || result.failures?.length) {
      throw new Error(result.error || result.failures.join('\n'));
    }
    console.log(`open-effects WebGL verification passed: ${files.length} shaders compiled and linked`);
    win.destroy();
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    app.exit(1);
  }
}

void run();
