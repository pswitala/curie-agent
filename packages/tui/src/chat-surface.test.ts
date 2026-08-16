import { describe, it, expect } from 'vitest';
import { applyDeletion } from './chat-surface.js';

describe('applyDeletion', () => {
  describe('backspace', () => {
    it('removes the character before the cursor', () => {
      expect(applyDeletion('abc', 3, 'backspace')).toEqual({ text: 'ab', cursor: 2 });
    });

    it('removes mid-string without touching the tail', () => {
      expect(applyDeletion('abcd', 2, 'backspace')).toEqual({ text: 'acd', cursor: 1 });
    });

    it('is a no-op at column 0', () => {
      // Regression: this used to return 'ababc' — slice(0, -1) + slice(0).
      expect(applyDeletion('abc', 0, 'backspace')).toEqual({ text: 'abc', cursor: 0 });
    });

    it('is a no-op on empty input', () => {
      expect(applyDeletion('', 0, 'backspace')).toEqual({ text: '', cursor: 0 });
    });
  });

  describe('delete', () => {
    it('removes the character at the cursor', () => {
      expect(applyDeletion('abc', 0, 'delete')).toEqual({ text: 'bc', cursor: 0 });
    });

    it('removes mid-string', () => {
      expect(applyDeletion('abcd', 2, 'delete')).toEqual({ text: 'abd', cursor: 2 });
    });

    it('is a no-op at end of line', () => {
      expect(applyDeletion('abc', 3, 'delete')).toEqual({ text: 'abc', cursor: 3 });
    });
  });

  it('clamps an out-of-range cursor', () => {
    expect(applyDeletion('abc', 99, 'backspace')).toEqual({ text: 'ab', cursor: 2 });
    expect(applyDeletion('abc', -5, 'backspace')).toEqual({ text: 'abc', cursor: 0 });
  });
});
