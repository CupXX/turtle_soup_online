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

    expect(KEY_POINT_EXTRACTION_PROMPT_VERSION).toBe('key-point-extraction-v5');
    expect(prompt).toContain('Return 3 to 5');
    expect(prompt).toContain('meaningful hidden milestones');
    expect(prompt).toContain('supported by full_solution');
    expect(prompt).toContain('Do not restate facts already disclosed by puzzle_surface');
    expect(prompt).toContain('Do not invent unsupported details');
    expect(prompt).toContain('atomic Evidence facts');
    expect(prompt).toContain('Evidence is hidden completion data');
    expect(prompt).toContain('Do not create a point merely to explain a surface detail');
    expect(prompt).not.toContain('Do not restate an explicit outcome or its immediate consequence');
    expect(prompt).toContain('Do not use optional slots for post-solution outcomes');
    expect(prompt).toContain('State only the hidden cause or relationship');
    expect(prompt).toContain('Do not include a surface time or action merely to contextualize the hidden fact');
    expect(prompt).toContain('SELECTION PROCEDURE');
    expect(prompt).toContain('Silently reconstruct the complete causal story');
    expect(prompt).toContain('atomic hidden facts, states, identities, relationships, actions, and causal mechanisms');
    expect(prompt).toContain('meaningful reasoning milestones');
    expect(prompt).toContain('SINGLE-QUESTION TEST');
    expect(prompt).toContain('PARTIAL COVERAGE SANITY TEST');
    expect(prompt).toContain('LOGICAL INDEPENDENCE TEST');
    expect(prompt).toContain('CHAIN COMPLETENESS TEST');
    expect(prompt).toContain('Do not create a separate key point merely for an outcome already disclosed by the surface');
    expect(prompt).toContain('an already-known outcome may be included inside a larger hidden mechanism');
    expect(prompt).toContain('A later point is independent only if it introduces a genuinely new hidden fact, state, relationship, action, or mechanism');
    expect(prompt).toContain('Merely narrating the obvious next consequence of an earlier point does not create a new milestone');
    expect(prompt).toContain('Do not compress to three when four or five are genuinely needed');
    expect(prompt).toContain("Order the final points by the player's logical reconstruction path");
    expect(prompt).toContain('normally following story chronology when that is meaningful');
    expect(prompt).not.toContain('If three sufficient points reconstruct the solution, return exactly three');
    expect(prompt).not.toContain('ordered by story chronology');
    expect(prompt).not.toContain('蚊子');
    expect(prompt).not.toContain('选择题');
    expect(prompt).not.toContain('蜜蜂');
    expect(prompt).not.toContain('回旋镖');
    expect(prompt).not.toContain('医学院');
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

  it('keeps the v5 policy focused on Evidence rather than history', () => {
    const prompt = buildKeyPointExtractionPrompt({
      puzzle_surface: 'surface',
      full_solution: 'solution',
    });
    expect(prompt).toContain('minimum Evidence facts required for completion');
    expect(prompt).toContain('Evidence may be negative only when full_solution supports that negative fact');
    expect(prompt).not.toContain('conversation_history');
  });

  it('keeps the result schema at exactly three to five content points', () => {
    expect(KEY_POINT_EXTRACTION_SCHEMA.required).toEqual(['key_points']);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.minItems).toBe(3);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.maxItems).toBe(5);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.items.required).toEqual(['content', 'evidence']);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.items.properties.evidence.minItems).toBe(1);
    expect(KEY_POINT_EXTRACTION_SCHEMA.properties.key_points.items.properties.evidence.maxItems).toBe(4);
  });
});
