import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildKeyPointExtractionPrompt,
  KEY_POINT_EXTRACTION_PROMPT_VERSION,
} from './key-point-extraction.js';
import { KEY_POINT_EXTRACTION_SCHEMA } from './validate-result.js';

describe('key-point extraction prompt', () => {
  it('publishes the hidden-fact extraction policy and version', () => {
    const prompt = buildKeyPointExtractionPrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
    });

    expect(KEY_POINT_EXTRACTION_PROMPT_VERSION).toBe('key-point-extraction-v3');
    expect(prompt).toContain('Return 3 to 5');
    expect(prompt).toContain('hidden facts or relationships');
    expect(prompt).toContain('supported by full_solution');
    expect(prompt).toContain('Do not restate facts already disclosed by puzzle_surface');
    expect(prompt).toContain('Do not invent unsupported details');
    expect(prompt).toContain('ordered by story chronology');
    expect(prompt).toContain('Do not create a point merely to explain a surface detail');
    expect(prompt).toContain('Do not restate an explicit outcome or its immediate consequence');
    expect(prompt).toContain('If three sufficient points reconstruct the solution, return exactly three');
    expect(prompt).toContain('Do not use optional slots for post-solution outcomes');
    expect(prompt).toContain('State only the hidden cause or relationship');
    expect(prompt).toContain('Do not include a surface time or action merely to contextualize the hidden fact');
    expect(prompt).toContain('decompose full_solution into atomic hidden facts and causal relationships');
    expect(prompt).toContain('independently discoverable and independently score-worthy');
    expect(prompt).toContain('INDEPENDENT DISCOVERY TEST');
    expect(prompt).toContain('PARTIAL COVERAGE SANITY TEST');
    expect(prompt).toContain('natural yes-or-no question');
    expect(prompt).toContain('Avoid unnecessary conjunctive key points');
    expect(prompt).toContain('Separate facts that can be naturally asked, discovered, and rewarded independently');
    expect(prompt).toContain('Do not split one inseparable relation into fragments');
    expect(prompt).toContain('HIDDEN FACT AND CAUSAL BRIDGE');
    expect(prompt).not.toContain('蚊子');
    expect(prompt).not.toContain('选择题');
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

  it('matches the frozen v3 policy snapshot before runtime data', () => {
    const prompt = buildKeyPointExtractionPrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
    });
    const policy = prompt.split('\nUNTRUSTED_DATA:\n')[0];
    const snapshot = readFileSync(new URL('./prompts/key-point-extraction-v3.txt', import.meta.url), 'utf8');
    expect(`${policy}\n`).toBe(snapshot);
  });

  it('keeps the result schema at exactly three to five content points', () => {
    expect(KEY_POINT_EXTRACTION_SCHEMA.required).toEqual(['key_points']);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.minItems).toBe(3);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.maxItems).toBe(5);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.items.required).toEqual(['content']);
  });
});
