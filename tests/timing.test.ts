import { describe, expect, it } from 'vitest';
import { frameSequence } from '../src/core/timing';

describe('frameSequence', () => {
  it('rocks back and forth without repeating the end frames', () => {
    expect(frameSequence(4, 'pingpong', 10).map((s) => s.pos * 3)).toEqual([0, 1, 2, 3, 2, 1]);
  });
  it('loops one way', () => {
    expect(frameSequence(3, 'forward', 10).map((s) => s.pos * 2)).toEqual([0, 1, 2]);
  });
  it('holds the first and last frames', () => {
    const s = frameSequence(3, 'pingpong', 10, 300);
    expect(s.map((x) => Math.round(x.ms))).toEqual([400, 100, 400, 100]);
  });
});
