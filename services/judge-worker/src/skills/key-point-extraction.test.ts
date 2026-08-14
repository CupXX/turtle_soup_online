import { describe, expect, it } from 'vitest';
import { buildKeyPointExtractionPrompt } from './key-point-extraction.js';

describe('key-point extraction prompt', () => {
  it('labels puzzle inputs as untrusted data and excludes conversation state', () => {
    const prompt = buildKeyPointExtractionPrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
    });

    expect(prompt).toContain('surface');
    expect(prompt).toContain('solution');
    expect(prompt).toContain('UNTRUSTED_DATA');
    expect(prompt).not.toContain('conversation_history');
    expect(prompt).not.toContain('discovered_key_points');
  });
});
