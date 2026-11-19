import { describe, expect, it } from 'vitest';
import { parseAssignedCard } from './useRoom';

describe('parseAssignedCard', () => {
  it('bevarer imageUrl og imageAlt når de er ikke-tomme strenger', () => {
    const parsed = parseAssignedCard({
      id: 'hist-manelandingen',
      label: 'Månelandingen',
      subtitle: 'Mennesket tar sine første skritt på månen',
      imageUrl: './images/events/manelandingen.webp',
      imageAlt: 'Astronaut i romdrakt på måneoverflaten',
      answerValue: 1969,
      answerDisplay: '1969',
    });

    expect(parsed).toEqual({
      id: 'hist-manelandingen',
      label: 'Månelandingen',
      subtitle: 'Mennesket tar sine første skritt på månen',
      imageUrl: './images/events/manelandingen.webp',
      imageAlt: 'Astronaut i romdrakt på måneoverflaten',
      answerValue: 1969,
      answerDisplay: '1969',
    });
  });

  it('utelater imageUrl og imageAlt uten undefined-nøkler for rene tekstkort', () => {
    const parsed = parseAssignedCard({
      id: 'r1-a',
      label: 'Kort A',
      subtitle: 'Plassholderkort · Runde 1',
      answerValue: 10,
      answerDisplay: 'Verdi: 10',
    });

    expect(parsed).toEqual({
      id: 'r1-a',
      label: 'Kort A',
      subtitle: 'Plassholderkort · Runde 1',
      answerValue: 10,
      answerDisplay: 'Verdi: 10',
    });
    expect(parsed).not.toBeNull();
    expect('imageUrl' in (parsed as object)).toBe(false);
    expect('imageAlt' in (parsed as object)).toBe(false);
  });

  it('ignorerer tomme strenger og ugyldige typer for imageUrl og imageAlt', () => {
    const parsed = parseAssignedCard({
      id: 'r1-b',
      label: 'Kort B',
      subtitle: 'Plassholderkort',
      imageUrl: '   ',
      imageAlt: 123,
      answerValue: 25,
      answerDisplay: 'Verdi: 25',
    });

    expect(parsed).not.toBeNull();
    expect('imageUrl' in (parsed as object)).toBe(false);
    expect('imageAlt' in (parsed as object)).toBe(false);
  });

  it('returnerer null for ugyldig eller ufullstendig kortdata', () => {
    expect(parseAssignedCard(null)).toBeNull();
    expect(parseAssignedCard(undefined)).toBeNull();
    expect(parseAssignedCard('ugyldig')).toBeNull();
    expect(parseAssignedCard({ id: 'x', label: 'Mangler felt' })).toBeNull();
  });
});
