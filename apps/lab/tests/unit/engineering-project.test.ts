import {expect,test,vi} from 'vitest';
import {EngineeringProjectStore} from '../../src/project/engineering-store';
import {makeEngineeringProject} from '../support/engineering';

test('editing draft does not mutate an existing run', () => {
  const store = new EngineeringProjectStore(makeEngineeringProject());
  const locked = store.snapshot();
  const edited = structuredClone(store.getDraft());
  edited.assembly.instances[0].pose.xyzM[0] += 0.1;
  store.replaceDraft(edited);
  expect(store.snapshot().assembly.instances[0].pose.xyzM[0])
    .not.toBe(locked.assembly.instances[0].pose.xyzM[0]);
});

test('snapshots and drafts are private copies; a snapshot is frozen all the way down', () => {
  const store = new EngineeringProjectStore(makeEngineeringProject());
  const snap = store.snapshot();
  expect(Object.isFrozen(snap)).toBe(true);
  expect(Object.isFrozen(snap.assembly.instances[0]!.pose.xyzM)).toBe(true);
  const draft = store.getDraft();
  draft.id = 'changed';
  expect(store.snapshot().id).not.toBe('changed');
  expect(() => { (snap.assembly.instances as unknown[]).push({}); }).toThrow();
});

test('every edit, undo and redo makes a new, higher revision and notifies subscribers', () => {
  const store = new EngineeringProjectStore(makeEngineeringProject());
  const listener = vi.fn(), off = store.subscribe(listener);
  const r0 = store.snapshot().revision;
  const a = store.getDraft(); a.assembly.instances[0]!.pose.xyzM[0] = 1;
  store.replaceDraft(a);
  const r1 = store.snapshot().revision;
  expect(store.undo()).toBe(true);
  const r2 = store.snapshot().revision;
  expect(store.snapshot().assembly.instances[0]!.pose.xyzM[0]).toBe(0);
  expect(store.redo()).toBe(true);
  const r3 = store.snapshot().revision;
  expect(store.snapshot().assembly.instances[0]!.pose.xyzM[0]).toBe(1);
  expect([r0 < r1, r1 < r2, r2 < r3]).toEqual([true, true, true]);
  expect(listener).toHaveBeenCalledTimes(3);
  off();
  expect(store.undo()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(3);
});

test('undo and redo report when there is nothing to do, and a new edit clears redo', () => {
  const store = new EngineeringProjectStore(makeEngineeringProject());
  expect(store.undo()).toBe(false);
  expect(store.redo()).toBe(false);
  const a = store.getDraft(); a.id = 'a'; store.replaceDraft(a);
  store.undo();
  const b = store.getDraft(); b.id = 'b'; store.replaceDraft(b);
  expect(store.redo()).toBe(false);
});
