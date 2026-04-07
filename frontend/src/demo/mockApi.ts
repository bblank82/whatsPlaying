/**
 * Demo mode API mock — intercepts all /api/* fetch calls and returns hardcoded
 * responses so the demo works without a running backend.
 *
 * Data sourced directly from the local API (TMDB + scores) so it matches
 * exactly what the real app would show.
 *
 * Install before mounting the React tree:
 *   import { installDemoMock } from './demo/mockApi';
 *   installDemoMock();
 */

interface CastMember { name: string; character: string; profile_url: string | null; }

interface DemoContent {
  poster_url: string;
  fullsize_url: string;
  backdrop_url: string;
  year: number;
  runtime: number | null;
  genres: string[];
  overview: string;
  tagline: string;
  vote_average: number;
  cast: CastMember[];
  tomatometer: number | null;
  audience_score: number | null;
  rt_url: string | null;
  imdb_id: string | null;
  imdb_rating: string | null;
}

const CONTENT: Record<string, DemoContent> = {
  'the dark knight': {
    poster_url:   'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    fullsize_url: 'https://image.tmdb.org/t/p/original/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/original/cfT29Im5VDvjE0RpyKOSdCKZal7.jpg',
    year: 2008, runtime: 152,
    genres: ['Action', 'Crime', 'Thriller'],
    tagline: 'Welcome to a world without rules.',
    overview: 'Batman raises the stakes in his war on crime. With the help of Lt. Jim Gordon and District Attorney Harvey Dent, Batman sets out to dismantle the remaining criminal organizations that plague the streets. The partnership proves to be effective, but they soon find themselves prey to a reign of chaos unleashed by a rising criminal mastermind known to the terrified citizens of Gotham as the Joker.',
    vote_average: 8.5,
    cast: [
      { name: 'Christian Bale',    character: 'Bruce Wayne',  profile_url: 'https://image.tmdb.org/t/p/w185/7Pxez9J8fuPd2Mn9kex13YALrCQ.jpg' },
      { name: 'Heath Ledger',      character: 'Joker',        profile_url: 'https://image.tmdb.org/t/p/w185/AdWKVqyWpkYSfKE5Gb2qn8JzHni.jpg' },
      { name: 'Aaron Eckhart',     character: 'Harvey Dent',  profile_url: 'https://image.tmdb.org/t/p/w185/u5JjnRMr9zKEVvOP7k3F6gdcwT6.jpg' },
      { name: 'Michael Caine',     character: 'Alfred',       profile_url: 'https://image.tmdb.org/t/p/w185/bVZRMlpjTAO2pJK6v90buFgVbSW.jpg' },
      { name: 'Maggie Gyllenhaal', character: 'Rachel',       profile_url: 'https://image.tmdb.org/t/p/w185/vsfkWdYWmA9CpzMHTJzrFxlDnEZ.jpg' },
    ],
    tomatometer: 94, audience_score: null,
    rt_url: 'https://www.rottentomatoes.com/m/the_dark_knight',
    imdb_id: 'tt0468569', imdb_rating: '9.1',
  },

  'dune: part two': {
    poster_url:   'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    fullsize_url: 'https://image.tmdb.org/t/p/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/original/eZ239CUp1d6OryZEBPnO2n87gMG.jpg',
    year: 2024, runtime: 167,
    genres: ['Science Fiction', 'Adventure'],
    tagline: 'Long live the fighters.',
    overview: 'Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen while on a path of revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, Paul endeavors to prevent a terrible future only he can foresee.',
    vote_average: 8.1,
    cast: [
      { name: 'Timothée Chalamet', character: 'Paul Atreides',       profile_url: 'https://image.tmdb.org/t/p/w185/axENiFIrSz5B7UuWkMT7PDe7CaO.jpg' },
      { name: 'Zendaya',           character: 'Chani',               profile_url: 'https://image.tmdb.org/t/p/w185/3WdOloHpjtjL96uVOhFRRCcYSwq.jpg' },
      { name: 'Rebecca Ferguson',  character: 'Jessica',             profile_url: 'https://image.tmdb.org/t/p/w185/lJloTOheuQSirSLXNA3JHsrMNfH.jpg' },
      { name: 'Javier Bardem',     character: 'Stilgar',             profile_url: 'https://image.tmdb.org/t/p/w185/p5xjCovj1uzvA2SXrWLH78Nh1Jf.jpg' },
      { name: 'Austin Butler',     character: 'Feyd-Rautha',         profile_url: 'https://image.tmdb.org/t/p/w185/atdAs4pFGjUQ4m2W8kJYly7N6cC.jpg' },
    ],
    tomatometer: 92, audience_score: null,
    rt_url: 'https://www.rottentomatoes.com/m/dune_part_two',
    imdb_id: 'tt15239678', imdb_rating: '8.4',
  },

  'succession': {
    poster_url:   'https://image.tmdb.org/t/p/w500/z0XiwdrCQ9yVIr4O0pxzaAYRxdW.jpg',
    fullsize_url: 'https://image.tmdb.org/t/p/original/z0XiwdrCQ9yVIr4O0pxzaAYRxdW.jpg',
    backdrop_url: 'https://image.tmdb.org/t/p/original/bcdUYUFk8GdpZJPiSAas9UeocLH.jpg',
    year: 2018, runtime: null,
    genres: ['Drama', 'Comedy'],
    tagline: 'Make your move.',
    overview: 'At Kendall\'s lavish birthday bash, Shiv and Roman try to arrange a meeting with Lukas Matsson, a tech mogul who recently snubbed Logan.',
    vote_average: 8.3,
    cast: [
      { name: 'Jeremy Strong',      character: 'Kendall Roy',         profile_url: 'https://image.tmdb.org/t/p/w185/jcMhXWICSi4QjQttJVhFSiKVvpF.jpg' },
      { name: 'Kieran Culkin',      character: 'Roman Roy',           profile_url: 'https://image.tmdb.org/t/p/w185/b5EC4nziLhBRX4GOcYx2BdS3FTt.jpg' },
      { name: 'Sarah Snook',        character: 'Siobhan \'Shiv\' Roy', profile_url: 'https://image.tmdb.org/t/p/w185/6aHeil5eCT0a1islyD3F93WsKm6.jpg' },
      { name: 'Brian Cox',          character: 'Logan Roy',           profile_url: 'https://image.tmdb.org/t/p/w185/scSjbFCTRngXlkJRoKptM5kQGw7.jpg' },
      { name: 'Matthew Macfadyen',  character: 'Tom Wambsgans',       profile_url: 'https://image.tmdb.org/t/p/w185/sFaIfkykJdftwrc3BdEfpdg2mYW.jpg' },
    ],
    tomatometer: 95, audience_score: null,
    rt_url: 'https://www.rottentomatoes.com/tv/succession',
    imdb_id: 'tt7660850', imdb_rating: '8.8',
  },
};

function matchContent(params: URLSearchParams): DemoContent | null {
  const title = (params.get('title') ?? '').toLowerCase();
  return CONTENT[title] ?? null;
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installDemoMock(): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input
      : input instanceof URL    ? input.href
      : (input as Request).url;

    if (!url.startsWith('/api/')) {
      return originalFetch(input, init);
    }

    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    const [path, qs] = url.split('?');
    const params = new URLSearchParams(qs ?? '');

    // /api/tmdb/details — full metadata + cast for CinematicKioskView
    if (path === '/api/tmdb/details') {
      const c = matchContent(params);
      if (c) {
        return Promise.resolve(json({
          available: true,
          overview: c.overview,
          tagline: c.tagline,
          genres: c.genres,
          year: c.year,
          runtime: c.runtime,
          vote_average: c.vote_average,
          cast: c.cast,
          poster_url: c.poster_url,
          fullsize_url: c.fullsize_url,
          backdrop_url: c.backdrop_url,
        }));
      }
      return Promise.resolve(json({ available: false }));
    }

    // /api/tmdb — poster art for device cards
    if (path === '/api/tmdb') {
      const c = matchContent(params);
      return Promise.resolve(json(c
        ? { poster_url: c.poster_url, fullsize_url: c.fullsize_url }
        : { poster_url: null, fullsize_url: null }
      ));
    }

    // /api/scores — RT + IMDb ratings
    if (path === '/api/scores') {
      const c = matchContent(params);
      return Promise.resolve(json(c
        ? { tomatometer: c.tomatometer, audience_score: c.audience_score, url: c.rt_url, imdb_id: c.imdb_id, imdb_rating: c.imdb_rating }
        : { tomatometer: null, audience_score: null, url: null, imdb_id: null, imdb_rating: null }
      ));
    }

    // /api/app_icon — skip in demo; UI handles null gracefully
    if (path === '/api/app_icon') {
      return Promise.resolve(json({ url: null }));
    }

    // /api/devices/*/artwork — demo devices have no native artwork
    if (path.startsWith('/api/devices/') && path.endsWith('/artwork')) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }

    // Anything else (controls, etc.) — return empty object rather than hanging
    return Promise.resolve(json({}));
  };
}
