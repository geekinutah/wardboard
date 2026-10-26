import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokens } from './tokens.ts';

function declaredCustomProperties(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = new Map<string, string>();
  const pattern = /(--wb-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  for (const match of withoutComments.matchAll(pattern)) {
    const name = match[1];
    const raw = match[2];
    if (name === undefined || raw === undefined) continue;
    expect(declared.has(name), `duplicate custom property ${name}`).toBe(false);
    declared.set(name, raw.trim());
  }
  return declared;
}

describe('design tokens', () => {
  it('tokens css and ts agree', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8');
    const declared = declaredCustomProperties(css);
    const names = Object.keys(tokens) as (keyof typeof tokens)[];
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      expect(declared.get(name), name).toBe(tokens[name]);
    }
    for (const name of declared.keys()) {
      expect(Object.prototype.hasOwnProperty.call(tokens, name), name).toBe(true);
    }
  });

  it('tokens match the design README', () => {
    expect(tokens['--wb-ground']).toBe('#F3F4F1');
    expect(tokens['--wb-surface']).toBe('#FFFFFF');
    expect(tokens['--wb-ink']).toBe('#18212B');
    expect(tokens['--wb-ink-2']).toBe('#3A444F');
    expect(tokens['--wb-muted']).toBe('#55606B');
    expect(tokens['--wb-line']).toBe('#D9DDD8');
    expect(tokens['--wb-line-inner']).toBe('#E1E4DF');
    expect(tokens['--wb-line-inner-soft']).toBe('#ECEEEA');
    expect(tokens['--wb-accent']).toBe('#1D5C68');
    expect(tokens['--wb-accent-soft']).toBe('#E3EEEF');
    expect(tokens['--wb-accent-dark']).toBe('#123E47');
    expect(tokens['--wb-vacancy-text']).toBe('#8A4209');
    expect(tokens['--wb-vacancy-border']).toBe('#C9772E');
    expect(tokens['--wb-vacancy-fill']).toBe('#FFF8F1');
    expect(tokens['--wb-vacancy-fill-deep']).toBe('#FBEFE3');
    expect(tokens['--wb-proposed-text']).toBe('#1F4E99');
    expect(tokens['--wb-proposed-fill']).toBe('#E6EDF8');
    expect(tokens['--wb-proposed-fill-soft']).toBe('#F3F7FD');
    expect(tokens['--wb-release-text']).toBe('#3A444F');
    expect(tokens['--wb-release-fill']).toBe('#ECEEEA');
    expect(tokens['--wb-needs-approval-text']).toBe('#5B2B6E');
    expect(tokens['--wb-needs-approval-fill']).toBe('#F2EAF5');
    expect(tokens['--wb-removed-hatch-a']).toBe('#E6E8E5');
    expect(tokens['--wb-removed-hatch-b']).toBe('#F4F5F3');
    expect(tokens['--wb-removed-border']).toBe('#8A929A');
    expect(tokens['--wb-removed-hatch']).toBe(
      'repeating-linear-gradient(135deg, #E6E8E5 0 6px, #F4F5F3 6px 12px)',
    );
    expect(tokens['--wb-accepted']).toBe('#2E5B3A');
    expect(tokens['--wb-tv-ground']).toBe('#10171E');
    expect(tokens['--wb-tv-card']).toBe('#18222C');
    expect(tokens['--wb-canvas-dot']).toBe('#D3D7D1');
    expect(tokens['--wb-canvas-dot-size']).toBe('1px');
    expect(tokens['--wb-canvas-dot-spacing']).toBe('22px');
    expect(tokens['--wb-font-sans']).toContain('IBM Plex Sans');
    expect(tokens['--wb-font-mono']).toContain('IBM Plex Mono');
    expect(tokens['--wb-section-label-size']).toBe('11px');
    expect(tokens['--wb-section-label-weight']).toBe('600');
    expect(tokens['--wb-section-label-transform']).toBe('uppercase');
    expect(tokens['--wb-section-label-spacing']).toBe('0.06em');
  });
});
