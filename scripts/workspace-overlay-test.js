'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handlers = {}, events = [], classes = new Set();
const focus = { isConnected: true, count: 0, focus() { this.count++; } };
const body = { style: { overflow: 'auto', overscrollBehavior: 'contain' }, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
const context = {
  document: { body, activeElement: focus, addEventListener: (name, handler) => { handlers[name] = handler; } },
  window: { addEventListener: (name, handler) => { handlers[name] = handler; }, dispatchEvent: event => events.push(event), toggleMobileMenu() { classes.delete('mobile-menu-open'); body.style.overflow = 'auto'; } },
  CustomEvent: class { constructor(name, value) { this.type = name; this.detail = value.detail; } }
};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../public/workspace-overlays.js'), 'utf8'), context);
const overlay = context.window.VoxelOverlay;
classes.add('mobile-menu-open'); body.style.overflow = 'hidden';
const reasons = [];
overlay.open('notifications', reason => reasons.push(reason), focus);
assert.equal(classes.has('mobile-menu-open'), false);
assert.equal(body.style.overflow, 'hidden');
overlay.open({ id: 'attendance', onClose: reason => reasons.push(reason), returnFocus: focus });
assert.deepEqual(reasons, ['replacement']);
assert.equal(focus.count, 0, 'Replacing a panel cannot return focus behind the new sheet');
assert.equal(overlay.active, 'attendance');
assert.equal(overlay.close('notifications'), false, 'A stale panel cannot close another active sheet');
let prevented = false;
handlers.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
assert.equal(prevented, true); assert.equal(overlay.active, null);
assert.equal(body.style.overflow, 'auto'); assert.equal(body.style.overscrollBehavior, 'contain');
assert.equal(focus.count, 1); assert.equal(classes.has('vv-overlay-open'), false);
overlay.open('one', () => overlay.open('two', () => {}, focus), focus);
overlay.close(); assert.equal(overlay.active, 'two'); assert.equal(body.style.overflow, 'hidden');
overlay.closeAll(); assert.equal(body.style.overflow, 'auto');
assert(events.some(event => event.type === 'vv:overlay-closed' && event.detail.reason === 'escape'));
console.log('WORKSPACE_OVERLAY_TEST_OK: exclusive sheets, menu handoff, Escape, focus return and scroll restoration');
