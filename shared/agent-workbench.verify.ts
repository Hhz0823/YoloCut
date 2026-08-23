import assert from 'node:assert/strict';
import {
  agentWorkbenchDropTarget,
  agentWorkbenchPointerTarget,
  isAgentWorkbenchRequest,
  isAgentWorkbenchState,
  nativeAgentDockDecision,
  nativeAgentDockTarget,
} from './agent-workbench';

assert.equal(isAgentWorkbenchRequest({ projectId: 'p1', dockSide: 'left' }), true);
assert.equal(isAgentWorkbenchRequest({
  projectId: 'p1', dockSide: 'right', detachAt: { screenX: 920, screenY: 240 },
}), true);
assert.equal(isAgentWorkbenchRequest({
  projectId: 'p1', dockSide: 'right', detachAt: { screenX: Number.NaN, screenY: 240 },
}), false);
assert.equal(isAgentWorkbenchRequest({ projectId: '', dockSide: 'right' }), false);
assert.equal(isAgentWorkbenchRequest({ projectId: 'p1', dockSide: 'top' }), false);
assert.equal(isAgentWorkbenchState({
  placement: 'detached', dockSide: 'right', projectId: 'p1', dockPreview: null,
}), true);
assert.equal(isAgentWorkbenchState({
  placement: 'floating', dockSide: 'right', projectId: 'p1', dockPreview: null,
}), false);

assert.equal(agentWorkbenchDropTarget(80, 1000), 'left');
assert.equal(agentWorkbenchDropTarget(199, 1000), 'left');
assert.equal(agentWorkbenchDropTarget(201, 1000), 'detached');
assert.equal(agentWorkbenchDropTarget(500, 1000), 'detached');
assert.equal(agentWorkbenchDropTarget(799, 1000), 'detached');
assert.equal(agentWorkbenchDropTarget(801, 1000), 'right');
assert.equal(agentWorkbenchDropTarget(920, 1000), 'right');
assert.equal(agentWorkbenchPointerTarget(500, 400, 1000, 800), 'detached');
assert.equal(agentWorkbenchPointerTarget(-1, 400, 1000, 800), 'detached');
assert.equal(agentWorkbenchPointerTarget(1001, 400, 1000, 800), 'detached');
assert.equal(agentWorkbenchPointerTarget(80, 400, 1000, 800), 'left');
assert.equal(agentWorkbenchPointerTarget(760, 400, 1000, 800), 'detached');

const main = { x: 100, y: 100, width: 1200, height: 800 };
assert.equal(nativeAgentDockTarget(main, { x: 140, y: 160 }), 'left', 'top-left corner docks left');
assert.equal(nativeAgentDockTarget(main, { x: 180, y: 850 }), 'left', 'bottom-left corner docks left');
assert.equal(nativeAgentDockTarget(main, { x: 1240, y: 160 }), 'right', 'top-right corner docks right');
assert.equal(nativeAgentDockTarget(main, { x: 1250, y: 850 }), 'right', 'bottom-right corner docks right');
assert.equal(nativeAgentDockTarget(main, { x: 700, y: 120 }), null, 'top edge centre stays detached');
assert.equal(nativeAgentDockTarget(main, { x: 120, y: 500 }), null, 'left edge centre stays detached');
assert.equal(nativeAgentDockTarget(main, { x: 197, y: 160 }), null, 'outside the 96px corner stays detached');
assert.equal(nativeAgentDockTarget(main, { x: 90, y: 90 }), null, 'outside the main window stays detached');

assert.deepEqual(
  nativeAgentDockDecision(main, { x: 140, y: 160 }, false),
  { armed: false, target: null },
  'a newly detached window cannot immediately snap back from its initial corner',
);
assert.deepEqual(
  nativeAgentDockDecision(main, { x: 700, y: 120 }, false),
  { armed: true, target: null },
  'leaving all corner hotspots arms native docking',
);
assert.deepEqual(
  nativeAgentDockDecision(main, { x: 1240, y: 160 }, true),
  { armed: true, target: 'right' },
  'an armed window docks after entering a corner',
);

console.log('agent-workbench.verify: transport validation and dock geometry passed');
