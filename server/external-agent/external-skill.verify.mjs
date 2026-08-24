import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mcp = readFileSync(resolve(root, 'server/external-agent/mcp.ts'), 'utf8');
const serverBaseline = /YOLOCUT_SKILL_BASELINE = '([^']+)'/.exec(mcp)?.[1];
for (const name of ['yolocut']) {
  const skillRoot = resolve(root, `skills/${name}`);
  const skillPath = resolve(skillRoot, 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8').replace(/\r\n?/g, '\n');
  assert.match(skill, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---`));
  assert.ok(skill.split('\n').length <= 500, `${name} SKILL.md must stay within 500 lines`);
  const references = [...skill.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1]);
  assert.ok(references.length > 0, `${name} SKILL.md must route to at least one reference`);
  for (const reference of references) {
    assert.ok(existsSync(resolve(skillRoot, reference)), `${name} missing ${reference}`);
  }
  const skillVersion = /## Skill version\s+\n`([^`]+)`/.exec(skill)?.[1];
  assert.equal(skillVersion, serverBaseline, `${name} skill version must match the MCP baseline`);

  const recovery = readFileSync(resolve(skillRoot, 'references/known-errors.md'), 'utf8')
    .replace(/\r\n?/g, '\n');
  assert.match(recovery, /`awaiting_review` means the draft is ready but not applied/);
  assert.doesNotMatch(recovery, /\bpending_review\b/);
  for (const legacyName of ['chatcut', 'openchatcut']) {
    assert.ok(recovery.includes(`\`${legacyName}\``), `missing legacy name ${legacyName}`);
    assert.ok(recovery.includes(`\`${legacyName}_status\``), `missing legacy status ${legacyName}_status`);
  }
}

console.log(`external skill verify: YoloCut primary entry OK (${serverBaseline})`);
