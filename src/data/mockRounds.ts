import type { AssignedCard, MockRound } from '../types/game';

/**
 * Spillrunder: starter med bildebasert historierunde, etterfulgt av plassholder-runder
 * for videre testing og sykling av spillmotoren.
 */
export const MOCK_ROUNDS: MockRound[] = [
  {
    id: 'historical-events-1',
    title: 'Historiske begivenheter',
    directionLabel: 'Eldst → Nyest',
    cards: [
      {
        id: 'hist-stiklestad',
        label: 'Slaget på Stiklestad',
        subtitle: 'Olav Haraldsson faller i Trøndelag',
        imageUrl: './images/events/slaget-pa-stiklestad.webp',
        imageAlt: 'Vikingkrigere i kamp på en tåkelagt norsk slagmark i middelalderen',
        answerValue: 1030,
        answerDisplay: '1030',
      },
      {
        id: 'hist-columbus',
        label: 'Columbus når Amerika',
        subtitle: 'Tre seilskip ankommer Karibia',
        imageUrl: './images/events/columbus-amerika.webp',
        imageAlt: 'Historiske seilskip som ankommer en tropisk kyst i soloppgang',
        answerValue: 1492,
        answerDisplay: '1492',
      },
      {
        id: 'hist-bastillen',
        label: 'Stormingen av Bastillen',
        subtitle: 'Opprør i Paris tenner den franske revolusjonen',
        imageUrl: './images/events/stormingen-av-bastillen.webp',
        imageAlt: 'Folkemengde som stormer en steinfestning i Paris blant røyk og flammer',
        answerValue: 1789,
        answerDisplay: '1789',
      },
      {
        id: 'hist-eidsvoll',
        label: 'Grunnloven på Eidsvoll',
        subtitle: 'Riksforsamlingen samles i Eidsvollsbygningen',
        imageUrl: './images/events/eidsvoll-grunnlov.webp',
        imageAlt: 'Utsendinger samlet i en historisk norsk sal under signeringen av Grunnloven',
        answerValue: 1814,
        answerDisplay: '1814',
      },
      {
        id: 'hist-eiffeltarnet',
        label: 'Eiffeltårnet åpner i Paris',
        subtitle: 'Jernkonstruksjonen innvies til verdensutstillingen',
        imageUrl: './images/events/eiffeltarnet-apner.webp',
        imageAlt: 'Besøkende i historiske klær foran det nyåpnede Eiffeltårnet i Paris',
        answerValue: 1889,
        answerDisplay: '1889',
      },
      {
        id: 'hist-wright',
        label: 'Brødrene Wrights første flytur',
        subtitle: 'Motorisert fly letter fra sanddynene i Kitty Hawk',
        imageUrl: './images/events/brodrene-wright-flytur.webp',
        imageAlt: 'Et tidlig dobbeltdekkerfly som letter lavt over sanddyner',
        answerValue: 1903,
        answerDisplay: '1903',
      },
      {
        id: 'hist-amundsen',
        label: 'Amundsen når Sydpolen',
        subtitle: 'Den norske polarekspedisjonen når frem på ski',
        imageUrl: './images/events/amundsen-sydpolen.webp',
        imageAlt: 'Polarekspedisjon med hundesleder og telt i endeløst antarktisk snølandskap',
        answerValue: 1911,
        answerDisplay: '1911',
      },
      {
        id: 'hist-titanic',
        label: 'Titanics forlis',
        subtitle: 'Passasjerskipet synker i Nord-Atlanteren',
        imageUrl: './images/events/titanics-forlis.webp',
        imageAlt: 'Stort passasjerskip omgitt av isfjell i mørkt hav under stjernehimmel',
        answerValue: 1912,
        answerDisplay: '1912',
      },
      {
        id: 'hist-manelandingen',
        label: 'Månelandingen',
        subtitle: 'Mennesket tar sine første skritt på månen',
        imageUrl: './images/events/manelandingen.webp',
        imageAlt: 'Astronaut i romdrakt på måneoverflaten med jorden synlig i verdensrommet',
        answerValue: 1969,
        answerDisplay: '1969',
      },
      {
        id: 'hist-berlinmuren',
        label: 'Berlinmurens fall',
        subtitle: 'Folket feirer når muren i Berlin åpnes',
        imageUrl: './images/events/berlinmurens-fall.webp',
        imageAlt: 'Jublende mennesker oppe på og foran Berlinmuren om kvelden',
        answerValue: 1989,
        answerDisplay: '1989',
      },
    ],
  },
  {
    id: 'celebrity-ages-1',
    title: 'Kjendiser etter alder',
    directionLabel: 'Eldst → Yngst',
    cards: [
      {
        id: 'celeb-kong-harald',
        label: 'Kong Harald V',
        subtitle: 'Norges konge',
        imageUrl: './images/celebrities/kong-harald.jpg',
        imageAlt: 'Portrett av Kong Harald V i gallauniform',
        answerValue: 1937,
        answerDisplay: 'Født 1937',
      },
      {
        id: 'celeb-dolly-parton',
        label: 'Dolly Parton',
        subtitle: 'Amerikansk countrystjerne og låtskriver',
        imageUrl: './images/celebrities/dolly-parton.jpg',
        imageAlt: 'Portrett av artisten Dolly Parton',
        answerValue: 1946,
        answerDisplay: 'Født 1946',
      },
      {
        id: 'celeb-tom-cruise',
        label: 'Tom Cruise',
        subtitle: 'Amerikansk filmskuespiller',
        imageUrl: './images/celebrities/tom-cruise.jpg',
        imageAlt: 'Portrett av skuespilleren Tom Cruise',
        answerValue: 1962,
        answerDisplay: 'Født 1962',
      },
      {
        id: 'celeb-atle-antonsen',
        label: 'Atle Antonsen',
        subtitle: 'Norsk komiker og skuespiller',
        imageUrl: './images/celebrities/atle-antonsen.jpg',
        imageAlt: 'Portrett av komikeren Atle Antonsen på scenen',
        answerValue: 1969,
        answerDisplay: 'Født 1969',
      },
      {
        id: 'celeb-leonardo-dicaprio',
        label: 'Leonardo DiCaprio',
        subtitle: 'Amerikansk filmskuespiller',
        imageUrl: './images/celebrities/leonardo-dicaprio.jpg',
        imageAlt: 'Portrett av skuespilleren Leonardo DiCaprio',
        answerValue: 1974,
        answerDisplay: 'Født 1974',
      },
      {
        id: 'celeb-else-kass-furuseth',
        label: 'Else Kåss Furuseth',
        subtitle: 'Norsk komiker og programleder',
        imageUrl: './images/celebrities/else-kass-furuseth.jpg',
        imageAlt: 'Portrett av programlederen Else Kåss Furuseth',
        answerValue: 1980,
        answerDisplay: 'Født 1980',
      },
      {
        id: 'celeb-taylor-swift',
        label: 'Taylor Swift',
        subtitle: 'Amerikansk popstjerne og låtskriver',
        imageUrl: './images/celebrities/taylor-swift.jpg',
        imageAlt: 'Portrett av artisten Taylor Swift',
        answerValue: 1989,
        answerDisplay: 'Født 1989',
      },
      {
        id: 'celeb-magnus-carlsen',
        label: 'Magnus Carlsen',
        subtitle: 'Norsk sjakkspiller',
        imageUrl: './images/celebrities/magnus-carlsen.jpg',
        imageAlt: 'Portrett av sjakkspilleren Magnus Carlsen',
        answerValue: 1990,
        answerDisplay: 'Født 1990',
      },
      {
        id: 'celeb-erling-haaland',
        label: 'Erling Braut Haaland',
        subtitle: 'Norsk fotballspiller',
        imageUrl: './images/celebrities/erling-haaland.jpg',
        imageAlt: 'Portrett av fotballspilleren Erling Braut Haaland i landslagsdrakt',
        answerValue: 2000,
        answerDisplay: 'Født 2000',
      },
      {
        id: 'celeb-billie-eilish',
        label: 'Billie Eilish',
        subtitle: 'Amerikansk artist og låtskriver',
        imageUrl: './images/celebrities/billie-eilish.jpg',
        imageAlt: 'Portrett av artisten Billie Eilish på scenen',
        answerValue: 2001,
        answerDisplay: 'Født 2001',
      },
    ],
  },
  {
    id: 'music-hits-1980-2000',
    title: 'Hits 1980–2000',
    directionLabel: 'Eldst → Nyest',
    cards: [
      {
        id: 'hit-queen',
        label: 'Another One Bites the Dust',
        subtitle: 'Queen',
        imageUrl: './images/hits/queen.jpg',
        imageAlt: 'Bandfoto av rockebandet Queen',
        answerValue: 1980,
        answerDisplay: '1980',
      },
      {
        id: 'hit-toto',
        label: 'Africa',
        subtitle: 'Toto',
        imageUrl: './images/hits/toto.jpg',
        imageAlt: 'Bandfoto av rockebandet Toto',
        answerValue: 1982,
        answerDisplay: '1982',
      },
      {
        id: 'hit-prince',
        label: 'Purple Rain',
        subtitle: 'Prince',
        imageUrl: './images/hits/prince.jpg',
        imageAlt: 'Portrett av artisten Prince',
        answerValue: 1984,
        answerDisplay: '1984',
      },
      {
        id: 'hit-bon-jovi',
        label: "Livin' on a Prayer",
        subtitle: 'Bon Jovi',
        imageUrl: './images/hits/bon-jovi.jpg',
        imageAlt: 'Rockebandet Bon Jovi på konsertscenen',
        answerValue: 1986,
        answerDisplay: '1986',
      },
      {
        id: 'hit-madonna',
        label: 'Like a Prayer',
        subtitle: 'Madonna',
        imageUrl: './images/hits/madonna.jpg',
        imageAlt: 'Popartisten Madonna på scenen',
        answerValue: 1989,
        answerDisplay: '1989',
      },
      {
        id: 'hit-nirvana',
        label: 'Smells Like Teen Spirit',
        subtitle: 'Nirvana',
        imageUrl: './images/hits/nirvana.jpg',
        imageAlt: 'Rockebandet Nirvana på konsertscenen',
        answerValue: 1991,
        answerDisplay: '1991',
      },
      {
        id: 'hit-whitney-houston',
        label: 'I Will Always Love You',
        subtitle: 'Whitney Houston',
        imageUrl: './images/hits/whitney-houston.jpg',
        imageAlt: 'Portrett av sangeren Whitney Houston',
        answerValue: 1992,
        answerDisplay: '1992',
      },
      {
        id: 'hit-oasis',
        label: 'Wonderwall',
        subtitle: 'Oasis',
        imageUrl: './images/hits/oasis.jpg',
        imageAlt: 'Rockebandet Oasis på scenen',
        answerValue: 1995,
        answerDisplay: '1995',
      },
      {
        id: 'hit-spice-girls',
        label: 'Wannabe',
        subtitle: 'Spice Girls',
        imageUrl: './images/hits/spice-girls.jpg',
        imageAlt: 'Popgruppen Spice Girls på konsert',
        answerValue: 1996,
        answerDisplay: '1996',
      },
      {
        id: 'hit-britney-spears',
        label: 'Oops!... I Did It Again',
        subtitle: 'Britney Spears',
        imageUrl: './images/hits/britney-spears.jpg',
        imageAlt: 'Portrett av popartisten Britney Spears',
        answerValue: 2000,
        answerDisplay: '2000',
      },
    ],
  },
  {
    id: 'placeholder-round-3',
    title: 'Plassholder-runde 3',
    directionLabel: 'Lavest → Høyest',
    cards: [
      { id: 'r3-a', label: 'Kort A', subtitle: 'Plassholderkort · Runde 3', answerValue: 12, answerDisplay: 'Verdi: 12' },
      { id: 'r3-b', label: 'Kort B', subtitle: 'Plassholderkort · Runde 3', answerValue: 24, answerDisplay: 'Verdi: 24' },
      { id: 'r3-c', label: 'Kort C', subtitle: 'Plassholderkort · Runde 3', answerValue: 36, answerDisplay: 'Verdi: 36' },
      { id: 'r3-d', label: 'Kort D', subtitle: 'Plassholderkort · Runde 3', answerValue: 51, answerDisplay: 'Verdi: 51' },
      { id: 'r3-e', label: 'Kort E', subtitle: 'Plassholderkort · Runde 3', answerValue: 68, answerDisplay: 'Verdi: 68' },
      { id: 'r3-f', label: 'Kort F', subtitle: 'Plassholderkort · Runde 3', answerValue: 82, answerDisplay: 'Verdi: 82' },
      { id: 'r3-g', label: 'Kort G', subtitle: 'Plassholderkort · Runde 3', answerValue: 99, answerDisplay: 'Verdi: 99' },
      { id: 'r3-h', label: 'Kort H', subtitle: 'Plassholderkort · Runde 3', answerValue: 118, answerDisplay: 'Verdi: 118' },
      { id: 'r3-i', label: 'Kort I', subtitle: 'Plassholderkort · Runde 3', answerValue: 142, answerDisplay: 'Verdi: 142' },
      { id: 'r3-j', label: 'Kort J', subtitle: 'Plassholderkort · Runde 3', answerValue: 190, answerDisplay: 'Verdi: 190' },
    ],
  },
];

/**
 * Henter en plassholder-runde basert på 1-basert rundetall og sykler uendelig gjennom MOCK_ROUNDS.
 */
export function getRoundByNumber(roundNumber: number): MockRound {
  const normalized = Math.max(1, Math.floor(roundNumber));
  const index = (normalized - 1) % MOCK_ROUNDS.length;
  return MOCK_ROUNDS[index];
}

function buildExtraCardLabel(zeroBasedIndex: number): string {
  if (zeroBasedIndex < 26) {
    return `Kort ${String.fromCharCode(65 + zeroBasedIndex)}`;
  }
  return `Kort #${zeroBasedIndex + 1}`;
}

/**
 * Returnerer nøyaktig `playerCount` unike plassholderkort for den gitte runden.
 * Dersom antall spillere overstiger rundens forhåndsdefinerte kort, genereres ekstra
 * plassholderkort automatisk med unike fasit-verdier.
 */
export function buildCardsForPlayerCount(
  round: MockRound,
  playerCount: number,
): AssignedCard[] {
  const targetCount = Math.max(0, Math.floor(playerCount));
  if (targetCount === 0) {
    return [];
  }

  const baseCards: AssignedCard[] = round.cards
    .slice(0, targetCount)
    .map((card) => ({ ...card }));

  if (targetCount <= baseCards.length) {
    return baseCards;
  }

  const maxExistingValue = round.cards.reduce(
    (max, card) => Math.max(max, card.answerValue),
    0,
  );

  const baseCount = baseCards.length;
  const extraCount = targetCount - baseCount;
  for (let offset = 0; offset < extraCount; offset += 1) {
    const cardIndex = baseCount + offset;
    const answerValue = maxExistingValue + (offset + 1) * 15;
    baseCards.push({
      id: `${round.id}-extra-${cardIndex + 1}`,
      label: buildExtraCardLabel(cardIndex),
      subtitle: `Plassholderkort · ${round.title}`,
      answerValue,
      answerDisplay: `Verdi: ${answerValue}`,
    });
  }

  return baseCards;
}
