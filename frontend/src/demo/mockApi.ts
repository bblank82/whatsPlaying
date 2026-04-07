/**
 * Demo mode API mock — intercepts all /api/* fetch calls and returns hardcoded
 * responses so the demo works without a running backend.
 *
 * TMDB images are served from image.tmdb.org (no API key required for delivery).
 * If a path is stale/wrong the image 404s silently — the UI shows the
 * no-artwork placeholder, which is the same as the pre-mock broken state.
 *
 * Install before mounting the React tree:
 *   import { installDemoMock } from './demo/mockApi';
 *   installDemoMock();
 */

const T = 'https://image.tmdb.org/t/p';

interface DemoContent {
  poster: string;
  fullsize: string;
  backdrop: string;
  year: number;
  runtime: number;
  genres: string[];
  overview: string;
  tagline: string;
  vote_average: number;
  cast: Array<{ name: string; character: string }>;
  tomatometer: number;
  audience_score: number;
  rt_url: string;
  imdb_id: string;
  imdb_rating: string;
}

const CONTENT: Record<string, DemoContent> = {
  'the dark knight': {
    poster:   `${T}/w500/qJ2tW6WMkB3jJzeTkHfSFdTmf6H.jpg`,
    fullsize: `${T}/original/qJ2tW6WMkB3jJzeTkHfSFdTmf6H.jpg`,
    backdrop: `${T}/original/nMKdUUepR0i5zn0y1T4CejMmVws.jpg`,
    year: 2008, runtime: 152,
    genres: ['Action', 'Crime', 'Drama'],
    tagline: 'Welcome to a world without rules.',
    overview: 'When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.',
    vote_average: 9.0,
    cast: [
      { name: 'Christian Bale',  character: 'Bruce Wayne / Batman' },
      { name: 'Heath Ledger',    character: 'Joker' },
      { name: 'Aaron Eckhart',   character: 'Harvey Dent / Two-Face' },
      { name: 'Michael Caine',   character: 'Alfred' },
      { name: 'Gary Oldman',     character: 'Lt. James Gordon' },
    ],
    tomatometer: 94, audience_score: 94,
    rt_url: 'https://www.rottentomatoes.com/m/the_dark_knight',
    imdb_id: 'tt0468569', imdb_rating: '9.0',
  },

  'dune: part two': {
    poster:   `${T}/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg`,
    fullsize: `${T}/original/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg`,
    backdrop: `${T}/original/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg`,
    year: 2024, runtime: 167,
    genres: ['Science Fiction', 'Adventure', 'Drama'],
    tagline: 'Long live the fighters.',
    overview: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the universe, he must prevent a terrible future only he can foresee.",
    vote_average: 8.5,
    cast: [
      { name: 'Timothée Chalamet', character: 'Paul Atreides' },
      { name: 'Zendaya',           character: 'Chani' },
      { name: 'Rebecca Ferguson',  character: 'Lady Jessica' },
      { name: 'Austin Butler',     character: 'Feyd-Rautha Harkonnen' },
      { name: 'Florence Pugh',     character: 'Princess Irulan' },
    ],
    tomatometer: 90, audience_score: 96,
    rt_url: 'https://www.rottentomatoes.com/m/dune_part_two',
    imdb_id: 'tt15239678', imdb_rating: '8.5',
  },

  'succession': {
    poster:   `${T}/w500/e2X8zRGkSsq11AKsFHG7DKScFRQ.jpg`,
    fullsize: `${T}/original/e2X8zRGkSsq11AKsFHG7DKScFRQ.jpg`,
    backdrop: `${T}/original/eSLT9MCZE5V3ydSJkxiZ7TRh6jS.jpg`,
    year: 2018, runtime: 60,
    genres: ['Drama'],
    tagline: '',
    overview: "The Roy family controls one of the biggest media and entertainment conglomerates in the world. This is the story of their fight over who will succeed their aging patriarch.",
    vote_average: 8.9,
    cast: [
      { name: 'Brian Cox',          character: 'Logan Roy' },
      { name: 'Jeremy Strong',      character: 'Kendall Roy' },
      { name: 'Sarah Snook',        character: 'Siobhan Roy' },
      { name: 'Matthew Macfadyen',  character: 'Tom Wambsgans' },
      { name: 'Kieran Culkin',      character: 'Roman Roy' },
    ],
    tomatometer: 97, audience_score: 95,
    rt_url: 'https://www.rottentomatoes.com/tv/succession',
    imdb_id: 'tt7660850', imdb_rating: '8.9',
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

    // Abort immediately if caller already cancelled
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
          cast: c.cast.map(m => ({ ...m, profile_url: null })),
          poster_url: c.poster,
          fullsize_url: c.fullsize,
          backdrop_url: c.backdrop,
        }));
      }
      return Promise.resolve(json({ available: false }));
    }

    // /api/tmdb — poster art for device cards
    if (path === '/api/tmdb') {
      const c = matchContent(params);
      return Promise.resolve(json(c
        ? { poster_url: c.poster, fullsize_url: c.fullsize }
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

    // Anything else — return empty object rather than hanging
    return Promise.resolve(json({}));
  };
}
