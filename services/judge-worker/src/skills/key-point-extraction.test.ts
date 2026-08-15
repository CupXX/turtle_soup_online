import { describe, expect, it } from 'vitest';
import {
  buildKeyPointExtractionPrompt,
  KEY_POINT_EXTRACTION_PROMPT_VERSION,
} from './key-point-extraction.js';

describe('key-point extraction prompt', () => {
  it('publishes the hidden-fact extraction policy and version', () => {
    const prompt = buildKeyPointExtractionPrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
    });

    expect(KEY_POINT_EXTRACTION_PROMPT_VERSION).toBe('key-point-extraction-v2');
    expect(prompt).toContain('Return 3 to 5');
    expect(prompt).toContain('hidden facts or relationships');
    expect(prompt).toContain('supported by full_solution');
    expect(prompt).toContain('Do not restate facts already disclosed by puzzle_surface');
    expect(prompt).toContain('Do not invent unsupported details');
    expect(prompt).toContain('Do not mechanically split one semantic fact');
    expect(prompt).toContain('ordered by story chronology');
  });

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
