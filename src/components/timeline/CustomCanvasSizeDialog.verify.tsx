import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CustomCanvasSizeDialog.tsx', import.meta.url), 'utf8');
assert.match(source, /role="dialog"/);
assert.equal((source.match(/type="number"/g) ?? []).length, 2);
assert.equal((source.match(/min=\{CANVAS_DIMENSION_MIN\}/g) ?? []).length, 2);
assert.equal((source.match(/max=\{CANVAS_DIMENSION_MAX\}/g) ?? []).length, 2);
assert.match(source, /type="submit"/);
assert.match(source, /ratioLabel\(parsed\.width, parsed\.height\)/);

console.log('CustomCanvasSizeDialog.verify: validated size fields and apply action passed');
