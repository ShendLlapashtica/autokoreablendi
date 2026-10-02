// Encar reverse-engineering proxy — uncapped, multi-fallback
// Supports full pagination over 200k+ listings
import { checkApiKey } from '../src/lib/rateLimit.js';
import dns from 'node:dns';
import { AsyncLocalStorage } from 'node:async_hooks';
import { noisyRows, majorityMerge } from '../src/lib/encarClean.js';
import { modelGroupsFrom, modelsFrom, manufacturersFrom, matchGroup, matchModel } from '../src/lib/modelResolve.js';
import { trackPrices, recentDropIds, seedFromCache, nextSeedIds, seedRemaining } from '../src/lib/priceTrack.js';
// Encar's egress failure on Vercel is a 17ms "fetch failed" -- far too fast
// for a round trip to Korea and far too fast for a WAF page, which would be
// an HTTP response, not a dead socket. That signature is what a dual-stack
// resolver produces when it prefers an AAAA record whose route is dead.
// Pinning to IPv4 costs nothing if the diagnosis is wrong and restores egress
// if it is right.
dns.setDefaultResultOrder('ipv4first');

import { cacheGet, cacheSet, cacheKeyFromQuery, FRESH_WINDOW_MS } from '../src/lib/serverCache.js';
import { withPower } from '../src/lib/power.js';
import { parseBodies, categoryPart, textBody, BODY_LABELS, BODY_VALUES } from '../src/lib/bodyType.js';

// Encar's Price field is in 만원 (manwon = 10,000 KRW) units, but the
// frontend's price filter dropdowns are labeled in EUR — matches
// src/lib/utils.js's KRW_TO_EUR (0.00067) * 10,000 = 6.7 EUR per manwon.
const EUR_PER_MANWON = 6.7;

// A hard floor below the frontend's own filter range. 201만원 rather than 200 —
// verified live that exactly 200만원 (2,000,000 KRW, ~€1,340) is a placeholder/
// "call for price" value shared by ~80 otherwise-unrelated listings (random
// makes, models, mileages, years, all pinned to the identical figure), which
// floated straight to the very top of the default cheapest-first sort as a
// wall of unpriced junk. Genuine cheap inventory starts varying naturally at
// 209만원+, so this only drops that placeholder cluster.
const MIN_PRICE_MANWON = 201;

// Site-wide hard floor — nothing registered before this model year is ever
// shown, regardless of what the year filter is set to (or left unset).
const MIN_YEAR = 2016;

// Only the first FEATURED_COUNT cars on the unfiltered homepage are curated
// (BMW/Mercedes/Audi/VW etc.) — everything past that is plain chronological
// order. FEATURED_POOL_SIZE is how many recent listings get scanned to find
// those FEATURED_COUNT candidates from.
const FEATURED_COUNT     = 20;
const FEATURED_POOL_SIZE = 240;

function eurToManwon(eur) {
  return Math.round(Number(eur) / EUR_PER_MANWON);
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://www.encar.com/',
  'Origin': 'https://www.encar.com',
};

// Self-hosted relay on Deno Deploy — verified live 2026-08-20 that its
// egress isn't on Encar's CloudFront-WAF datacenter blocklist (unlike
// Vercel/AWS and a self-hosted Cloudflare Worker, both confirmed blocked
// the same day). Locked server-side to only forward to api.encar.com, and
// requires this shared secret — it was briefly a fully open relay (anyone
// who found the URL could use it for free), fixed the same day it was
// caught.
const DENO_RELAY = 'https://autokoreablendi-encar-relay.shendllapashtica.deno.net/';
const DENO_RELAY_HEADERS = { 'x-relay-secret': process.env.DENO_RELAY_SECRET || '' };

// Relay running on a RESIDENTIAL connection (local-relay/relay.mjs behind a
// tunnel). Encar's block is on datacenter egress -- AWS, Cloudflare, Vercel
// and Deno Deploy were all confirmed blocked on 2026-09-14 while a request
// from a home connection returned live listings the same minute. So the one
// egress that still works is a machine on an ordinary ISP.
//
// Entirely optional and OFF unless LOCAL_RELAY_URL is set: when the env var
// is absent the attempt is never added to the race below, so an unconfigured
// deployment behaves exactly as before. The tradeoff is honest -- this only
// answers while that machine and its tunnel are up, which is why it is one
// more rung on the ladder rather than a replacement for it.
const LOCAL_RELAY = (process.env.LOCAL_RELAY_URL || '').trim();
const LOCAL_RELAY_HEADERS = { 'x-relay-secret': process.env.LOCAL_RELAY_SECRET || '' };

// English brand name → Korean Encar identifier
// (BMW, Audi, Porsche etc. are stored in Encar under their own name or Korean)
export const MANUFACTURER_REVERSE = {
  // Verified against Encar 2026-09-19 by querying each candidate and keeping
  // the spelling that returned a non-zero count -- Tesla alone is 1,549 cars
  // that previously fell through to the unfiltered fallback, so a Tesla search
  // returned other makes entirely. Citroen, Skoda and Seat are deliberately
  // absent: Encar lists none of them under any spelling tried.
  'Tesla':           '테슬라',
  'Mazda':           '마쯔다',
  'Chrysler':        '크라이슬러',
  'Dodge':           '닷지',
  'Smart':           '스마트',
  'Hyundai':         '현대',
  'Kia':             '기아',
  'Mercedes-Benz':   '벤츠',
  'Mercedes Benz':   '벤츠',
  'Mercedes':        '벤츠',
  'Benz':            '벤츠',
  'Audi':            '아우디',
  'Volkswagen':      '폭스바겐',
  'Porsche':         '포르쉐',
  'Lexus':           '렉서스',
  'Genesis':         '제네시스',
  // KG Mobility (rebranded from SsangYong Motor) and Renault Korea
  // (rebranded from Renault Samsung) — Encar now stores these under a
  // compound "NewName(OldName)" facet value; the plain legacy Korean name
  // returns zero results. Old English aliases kept for back-compat.
  'KG Mobility':     'KG모빌리티(쌍용)',
  'SsangYong':       'KG모빌리티(쌍용)',
  'Ssangyong':       'KG모빌리티(쌍용)',
  'Renault Korea':   '르노코리아(삼성)',
  'Renault Samsung': '르노코리아(삼성)',
  'Renault':         '르노',
  // GM Korea's domestic-market Chevrolet listings are tagged with a
  // "(GM대우)" suffix (formerly GM Daewoo) — this is the dominant facet
  // value; a small number of imported Chevrolets remain under plain 쉐보레.
  'Chevrolet':       '쉐보레(GM대우)',
  'Volvo':           '볼보',
  'Land Rover':      '랜드로버',
  'Mini':            '미니',
  'Toyota':          '도요타',
  'Honda':           '혼다',
  'Maserati':        '마세라티',
  'Ferrari':         '페라리',
  'Lamborghini':     '람보르기니',
  'Bentley':         '벤틀리',
  'Rolls-Royce':     '롤스로이스',
  'Peugeot':         '푸조',
  'Jaguar':          '재규어',
  'Nissan':          '닛산',
  'Infiniti':        '인피니티',
  'Lincoln':         '링컨',
  'Cadillac':        '캐딜락',
  'Jeep':            '지프',
  'Ford':            '포드',
  'Subaru':          '스바루',
  'Mitsubishi':      '미쓰비시',
  'Alfa Romeo':      '알파로메오',
  'Fiat':            '피아트',
  // Brands where Encar uses English — pass through unchanged
  'BMW':             'BMW',
};

// English model name → Korean Encar model identifier
const MODEL_REVERSE = {
  'Avante':    '아반떼', 'Elantra':  '아반떼',
  'Sonata':    '쏘나타', 'Grandeur': '그랜저',
  'Tucson':    '투싼',   'Santa Fe': '싼타페', 'Santafe': '싼타페',
  'Palisade':  '팰리세이드', 'Kona':    '코나',
  'Ioniq':     '아이오닉', 'Ioniq 5': '아이오닉5', 'Ioniq 6': '아이오닉6',
  'Veloster':  '벨로스터', 'Staria':  '스타리아', 'Starex': '스타렉스',
  'Casper':    '캐스퍼',
  'Morning':   '모닝',  'Picanto': '모닝', 'Ray':     '레이',
  'Stonic':    '스토닉', 'Niro':    '니로', 'Seltos':  '셀토스',
  'Sportage':  '스포티지', 'Sorento': '쏘렌토', 'Carnival': '카니발',
  'Stinger':   '스팅어', 'Telluride': '텔루라이드',
  'Tivoli':    '티볼리', 'Rexton':   '렉스턴', 'Korando': '코란도',
  'Musso':     '무쏘',  'Torres':   '토레스',
  'Golf':      '골프',  'Polo':     '폴로',  'Passat':  '파사트',
  'Tiguan':    '티구안', 'Touareg':  '투아렉', 'Arteon':  '아테온',
  'Malibu':    '말리부', 'Spark':    '스파크', 'Equinox': '이쿼녹스',
  'Trailblazer': '트레일블레이저', 'Cruze': '크루즈',
  'Camry':     '캠리',  'Corolla':  '코롤라', 'Prius':   '프리우스',
  'RAV4':      '라브4', 'Highlander': '하이랜더', 'Yaris': '야리스', 'Vitz': '야리스',
  'Accord':    '어코드', 'Civic':   '시빅',
  'Altima':    '알티마', 'Murano':   '무라노', 'Rogue':   '로그',
  'Outlander': '아웃랜더', 'Forester': '포레스터', 'Outback': '아웃백',
  // Mercedes-AMG's standalone sports-car line — Encar stores this literally
  // in English with no Korean translation and no generation-code suffix
  // (verified live), so it's a genuine exact facet value, unlike the rest
  // of the Mercedes lineup (C/E/S-Class etc.) which always carry one.
  'AMG GT':    'AMG GT',
};

// Albanian/English fuel → Korean Encar FuelType
const FUEL_MAP = {
  diesel:   '디젤', dizel:    '디젤',
  gasoline: '가솔린', benzin:   '가솔린', benzine: '가솔린', petrol: '가솔린',
  electric: '전기',  elektrik: '전기',  ev: '전기',
  hybrid:   '하이브리드', hibrid: '하이브리드',
  lpg:      'LPG',
};

// Albanian/English transmission → Korean Encar Transmission (verified live
// facet values: 오토/수동/세미오토/CVT — 기타 "other" omitted, negligible count)
const TRANSMISSION_MAP = {
  automatic: '오토', automatik: '오토', auto: '오토',
  manual:    '수동',
  semiauto:  '세미오토', 'semi-automatik': '세미오토', semiautomatik: '세미오토',
  cvt:       'CVT',
};

// Albanian/English color → Korean Encar Color (verified live facet values +
// counts, pulled directly from Encar's own iNav facet metadata on
// 2026-08-26 — top 16 by listing count covers ~98% of all live inventory)
const COLOR_MAP = {
  white: '흰색', ebardhe: '흰색',
  black: '검정색', ezeze: '검정색',
  gray: '쥐색', grey: '쥐색', gri: '쥐색',
  blue: '청색', kalter: '청색',
  silver: '은색', argjendte: '은색',
  silvergray: '은회색',
  pearl: '진주색',
  red: '빨간색', ekuqe: '빨간색',
  skyblue: '하늘색',
  green: '녹색', jeshile: '녹색', gjelber: '녹색', egjelber: '녹색',
  brown: '갈색', kafe: '갈색',
  yellow: '노란색', verdhe: '노란색', everdhe: '노란색',
  orange: '주황색', portokalli: '주황색',
  purple: '보라색', vjollce: '보라색', evjollce: '보라색',
  pink: '분홍색', roze: '분홍색', eroze: '분홍색',
  gold: '금색', arte: '금색', earte: '금색',
};

// Case-insensitive dictionary lookup — returns the matched dictionary key, or null.
// "bmw x5" -> { make: 'BMW', rest: 'x5' }; the make is the longest leading
// run of words (up to three) that names one.
function splitMake(text) {
  const words = String(text).trim().split(/\s+/);
  for (let len = Math.min(3, words.length); len >= 1; len--) {
    const cand = words.slice(0, len).join(' ');
    const key = findKey(MANUFACTURER_REVERSE, cand);
    const make = key ? MANUFACTURER_REVERSE[key] : (Object.values(MANUFACTURER_REVERSE).includes(cand) ? cand : null);
    if (make) return { make, rest: words.slice(len).join(' ') };
  }
  return { make: null, rest: String(text).trim() };
}

function findKey(dict, val) {
  if (Object.prototype.hasOwnProperty.call(dict, val)) return val;
  return Object.keys(dict).find(k => k.toLowerCase() === val.toLowerCase()) || null;
}

function toEncarManufacturer(val) {
  if (!val) return null;
  const key = findKey(MANUFACTURER_REVERSE, val);
  return key ? MANUFACTURER_REVERSE[key] : val;
}

// BMW-style numbered series ("1 Series", "3-Series") are stored on Encar as
// "N시리즈", usually with a generation code appended (e.g. "1시리즈 (F20)"),
// so this is only ever used as a substring term, never an exact filter value.
function seriesTransliteration(val) {
  const m = val.trim().match(/^(\d)\s*-?\s*series$/i);
  return m ? `${m[1]}시리즈` : null;
}

// Models not in the Korean-market dictionary are almost always alphanumeric
// export codes (X5, A4, RS6, C200...) that Encar stores upper-cased.
function toEncarModel(val) {
  if (!val) return null;
  const key = findKey(MODEL_REVERSE, val);
  if (key) return MODEL_REVERSE[key];
  return seriesTransliteration(val) ?? val.toUpperCase();
}

// True only for a confirmed MODEL_REVERSE dictionary hit — the one case
// where the Encar value is known to be the car's literal, complete Model
// facet rather than a base name Encar likely stores with a generation-code
// suffix. Anything else (series transliteration, upper-cased passthrough)
// is a substring term only, per the comments on seriesTransliteration/toEncarModel.
function isExactEncarModel(val) {
  return !!val && !!findKey(MODEL_REVERSE, val);
}

// Parse a free-text keyword like "hyundai tucson" or "bmw x5" into filter parts.
// Matching is case-insensitive throughout so natural, lowercase typing works.
// `remainder` keeps the (possibly transliterated) leftover text for the
// substring fallback tier, which is where series names actually get resolved.
function parseKeyword(keyword) {
  if (!keyword) return {};
  const parts = keyword.trim().split(/\s+/);

  // Check if the first word(s) match a manufacturer (longest match wins)
  for (let len = Math.min(parts.length, 3); len >= 1; len--) {
    const candidate = parts.slice(0, len).join(' ');
    const key = findKey(MANUFACTURER_REVERSE, candidate);
    if (key) {
      const rest = parts.slice(len).join(' ');
      const result = { manufacturer: MANUFACTURER_REVERSE[key] };
      if (rest) {
        const translit   = seriesTransliteration(rest);
        result.model      = translit ?? toEncarModel(rest);
        // Use the resolved model value (Korean dictionary hit or transliterated
        // series), not the raw English text — the substring fallback tokenizes
        // against Encar's raw Hangul/passthrough-code fields, so English text
        // like "yaris" would never match the real "야리스(비츠)" listing data.
        result.remainder  = result.model;
        result.modelExact = !translit && isExactEncarModel(rest);
      }
      return result;
    }
  }

  // "N Series" typed with no manufacturer is BMW's signature naming — hint it
  const translit = seriesTransliteration(keyword);
  if (translit) {
    return { manufacturer: MANUFACTURER_REVERSE['BMW'], model: translit, remainder: translit, modelExact: false };
  }

  // No manufacturer recognized — treat the whole keyword as a model/badge search
  return { model: toEncarModel(keyword.trim()), remainder: keyword.trim(), modelExact: isExactEncarModel(keyword.trim()) };
}

async function attempt(fetchUrl, isWrapped, signal, label, extraHeaders = {}) {
  let r;
  try {
    r = await fetch(fetchUrl, { signal, headers: extraHeaders });
  } catch (err) {
    // Node collapses every transport-layer failure into the bare string
    // "fetch failed" and hides the actual reason on err.cause. Unlabelled and
    // uncaused, the aggregated detail line read "fetch failed" for weeks --
    // indistinguishable between DNS failure, a refused connection, a TLS
    // error and a WAF dropping the socket, which are four different problems
    // with four different fixes. The cause code is what says which.
    const cause = err?.cause;
    const bits  = [label, err?.message, cause?.code, cause?.message]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    const e = new Error(bits.join(': '));
    e.cause = cause;
    throw e;
  }
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
  const text = await r.text();

  let data;
  if (isWrapped) {
    const outer = JSON.parse(text);
    if (outer.status?.http_code === 403) throw new Error(`${label}: Encar 403 via proxy`);
    if (!outer.contents) throw new Error(`${label}: empty proxy contents`);
    data = JSON.parse(outer.contents);
  } else {
    data = JSON.parse(text);
  }

  if (!Array.isArray(data?.SearchResults)) throw new Error(`${label}: no SearchResults`);
  return data;
}

// SellType.일반 ("normal sale") excludes 리스/렌트 (lease/rental-transfer)
// listings — those carry a nominal placeholder Price (their real cost is a
// monthly payment, tracked in separate MonthLease* fields we don't show),
// so left in, they look like implausible near-zero-price "deals" and float
// straight to the top of any price-ascending sort. They're also not
// something this import business can actually source for a buyer abroad.
//
// Condition.Inspection requires Encar's own performance/inspection record
// (성능기록부) to be on file — verified live at 204,156 of 213,055 normal-sale
// listings (96%), matching this site's own "every car is inspected" claim,
// so this only drops the small uninspected/unverifiable minority.
// Default browsing (no explicit price sort) is ranked newest-first by Encar,
// which mixes in thin, undocumented listings alongside genuinely well-kept
// cars. This nudges better-documented, lower-risk listings to the top of
// each fetched page without touching an explicit user sort choice — Trust/
// ServiceMark badges and richer photo sets are Encar's own signals of a
// more trustworthy, "complete" listing; recent/low-mileage cars get a small
// boost too since they're the ones buyers actually want surfaced first.
// Raw Encar Manufacturer values for the brands the business wants leading
// the default homepage feed — desirable German makes buyers actually want
// to see first, not just whatever happened to list most recently.
const FEATURED_MANUFACTURERS = new Set(['BMW', '벤츠', '아우디', '폭스바겐']);

// Base-model tokens for the "sweet spot" executive trims called out by name
// (3 Series, C/E/S-Class, A6/A7, Passat/Arteon) — Encar always suffixes a
// generation code (e.g. "3시리즈 (F30)"), so this only needs a prefix check.
const FEATURED_MODEL_PREFIXES = [
  '3시리즈', '5시리즈', 'C-클래스', 'E-클래스', 'S-클래스', 'A6', 'A7', '파사트', '아테온',
];

function isFeaturedModel(model) {
  const m = String(model || '');
  return FEATURED_MODEL_PREFIXES.some(p => m.startsWith(p));
}

function qualityScore(car) {
  let score = 0;
  score += (car.Condition   || []).length * 2;
  score += (car.Trust       || []).length * 3;
  score += (car.ServiceMark || []).length * 2;
  if ((car.Photos || []).length >= 8) score += 2;

  const year = parseInt(String(car.FormYear || car.Year || '').slice(0, 4)) || 0;
  if (year >= 2021) score += 2;
  else if (year >= 2018) score += 1;

  if (car.Mileage != null) {
    if (car.Mileage < 50000) score += 2;
    else if (car.Mileage < 100000) score += 1;
  }

  if (FEATURED_MANUFACTURERS.has(car.Manufacturer)) {
    score += 6;
    if (isFeaturedModel(car.Model)) score += 3;
  }

  // "Good deal" band — a well-priced executive car in a range Kosovo buyers
  // actually shop in, rather than either a stripped high-mileage relic or
  // an unrealistic exotic outlier at the top of the market.
  const priceEur = (car.Price || 0) * EUR_PER_MANWON;
  if (priceEur >= 8000 && priceEur <= 25000) score += 2;

  return score;
}

/**
 * The exact Encar URL a search resolves to.
 *
 * Extracted so the SAME string the server tried can be handed to the browser
 * when every server-side egress is blocked. Encar serves
 * `Access-Control-Allow-Origin: *` (verified 2026-09-14), so a visitor can
 * fetch it from their own connection — the one egress not on the CloudFront
 * WAF list, which on that date had Vercel, AWS, Cloudflare and Deno Deploy on
 * it simultaneously while every free public CORS proxy was dead.
 *
 * Building the query in one place matters: a hand-ported client-side copy
 * would drift from the server's filter semantics, and the failure mode of
 * that drift is silently returning cars that do not match the search.
 */
// Age of a degraded response, stated in headers as well as the body.
//
// A body flag is only honoured by a caller who already knows to look for it.
// An integrator wiring us up for the first time reads status and headers, so
// a stale response that is HTTP-indistinguishable from a fresh one reads as
// "the API is fine, your cars are current" -- which is how 13-day-old
// listings were served to a paying client for two weeks without anything in
// the transaction saying otherwise. `Warning: 110` is the registered code
// for exactly this and costs nothing to send.
export function staleHeaders(res, cachedAt) {
  const ageSec = cachedAt ? Math.max(0, Math.floor((Date.now() - cachedAt) / 1000)) : null;
  res.setHeader('Warning', '110 - "Response is Stale"');
  res.setHeader('X-Data-Stale', 'true');
  // Deliberately NOT the standard `Age` header: that one has defined
  // meaning for every CDN in the path, and this response is already sitting
  // behind Vercel's edge. An X- header states the same fact and cannot change
  // how anything caches.
  if (ageSec != null) {
    res.setHeader('X-Data-Age-Seconds', String(ageSec));
    res.setHeader('X-Data-Cached-At', new Date(cachedAt).toISOString());
  }
}

export function buildEncarUrl(parts, offset, count, sortKey = 'ModifiedDate') {
  const allParts = ['SellType.일반', 'Condition.Inspection', ...parts];
  // Each plain term ends in "."; a group like "(Or.Category.A._.Category.B.)"
  // is already closed and takes no dot (Encar answers 400 if it gets one).
  // For plain terms this produces exactly the string it always did.
  const terms  = allParts.map(p => (p.startsWith('(') ? p : `${p}.`));
  const filter = `(And.Hidden.N._.${terms.join('_.')})`;
  // Id-list queries (the newest/price-drop feeds) never read the facet tree,
  // which is ~165 KB per response; everything else keeps it as before.
  const byIds = allParts.some(p => p.startsWith('(Or.CarId.'));
  return `https://api.encar.com/search/car/list/general?${new URLSearchParams({
    count: 'true',
    q:     filter,
    sr:    `|${sortKey}|${offset}|${count}`,
    ...(byIds ? {} : { inav: '|Metadata|Sort' }),
  })}`;
}

// Live-only (trial) keys get every Encar response checked for Encar's
// injected-character noise (see encarClean.js): a noisy page is fetched
// again, and if it stays noisy each field is settled by majority across three
// fetches. Scoped with AsyncLocalStorage so every search inside that request
// -- body scans and facet reads included -- is covered, and no other caller
// pays the extra fetches.
const liveStore = new AsyncLocalStorage();

async function runSearch(...args) {
  if (!liveStore.getStore()?.clean) return rawSearch(...args);
  const first = await rawSearch(...args);
  if (!noisyRows(first.SearchResults).length) return first;
  const second = await rawSearch(...args).catch(() => null);
  if (second && !noisyRows(second.SearchResults).length) return second;
  const third = await rawSearch(...args).catch(() => null);
  return majorityMerge([first, second, third].filter(Boolean));
}

// Encar's model list per make, read from its facet tree. Model names change
// only when Encar adds a model, so this is kept per instance for six hours;
// listings themselves are never cached for a live-only key.
const groupCache = new Map();   // make -> { at, groups }
const modelCache = new Map();   // make|group -> { at, models }
const META_TTL_MS = 6 * 60 * 60 * 1000;

async function modelGroupsOf(make, signal) {
  const hit = groupCache.get(make);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.groups;
  // Domestic makes sit under CarType.Y, imports under CarType.N; ask both.
  const trees = await Promise.all(['Y', 'N'].map(t =>
    rawSearch([`(C.CarType.${t}._.Manufacturer.${make}.)`], 0, 1, signal).catch(() => null)));
  const groups = trees.flatMap(d => modelGroupsFrom(d?.iNav));
  if (groups.length) groupCache.set(make, { at: Date.now(), groups });
  return groups;
}

async function modelsOf(make, group, signal) {
  const key = `${make}|${group}`;
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.models;
  const d = await rawSearch([`(C.Manufacturer.${make}._.ModelGroup.${group}.)`], 0, 1, signal).catch(() => null);
  const models = modelsFrom(d?.iNav);
  if (models.length) modelCache.set(key, { at: Date.now(), models });
  return models;
}

// The makes a model name is looked up in when the caller gives none.
const LOOKUP_MAKES = ['현대', '기아', '제네시스', '벤츠', 'BMW', '아우디', '폭스바겐', '포르쉐',
  '볼보', '미니', '랜드로버', '테슬라', '렉서스', '쉐보레(GM대우)', '르노코리아(삼성)', 'KG모빌리티(쌍용)'];

/**
 * Resolves the requested model for a live-only key onto exact Encar filter
 * parts, or explains why it cannot. Returns { make, parts } on a match,
 * { unknown: true, known } when the make has no such model.
 */
async function resolveModel(make, text, signal) {
  const makes = make ? [make] : LOOKUP_MAKES;
  const lists = await Promise.all(makes.map(async m => ({ make: m, groups: await modelGroupsOf(m, signal) })));
  let found = null;
  for (const { make: m, groups } of lists) {
    const hit = matchGroup(groups, text);
    if (hit && (!found || hit.group.value.length > found.hit.group.value.length)) found = { make: m, hit };
  }
  if (!found) {
    const known = make ? (lists[0].groups || []).map(g => g.eng || g.value) : [];
    return { unknown: true, known };
  }
  const parts = [`Manufacturer.${found.make}`, `ModelGroup.${found.hit.group.value}`];
  let generation = null;
  if (found.hit.rest) {
    generation = matchModel(await modelsOf(found.make, found.hit.group.value, signal), found.hit.group.value, found.hit.rest);
    if (!generation) return { unknown: true, known: await modelsOf(found.make, found.hit.group.value, signal) };
    parts.push(`Model.${generation}`);
  }
  return { make: found.make, parts, modelGroup: found.hit.group.value, model: generation };
}

// ── Feeds for live-only keys: newest listings and price drops ──────────────
//
// Newest: Encar has no "newest first" sort (its own site offers only
// recently-updated, price, mileage and year), and a search returns at most
// ~10,000 distinct rows -- deeper pages repeat (verified 2026-10-02: page
// 30,000 == page 12,000). What Encar does have is sequential car ids: a
// higher id was registered later (checked against firstAdvertisedDateTime).
// So the newest listings are read by id, newest first, 200 ids per query
// (Encar refuses longer URLs with 414), filters applied in the same query.

const ID_CHUNK = 200;
const idGroup = (hi, lo) => {
  const ids = [];
  for (let i = hi; i >= lo; i--) ids.push(`CarId.${i}.`);
  return `(Or.${ids.join('_.')})`;
};

// Encar's readside record: when the car was first advertised and whether it
// is reserved. firstAdvertisedDateTime is Korean local time.
async function readside(id, signal) {
  const url = `https://api.encar.com/v1/readside/vehicle/${id}`;
  const enc = encodeURIComponent(url);
  const one = async (u, headers) => {
    const r = await fetch(u, { signal, headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j?.manage) throw new Error('no manage block');
    return j;
  };
  const j = await Promise.any([
    one(url, BROWSER_HEADERS),
    one(`${DENO_RELAY}?url=${enc}`, DENO_RELAY_HEADERS),
    ...(LOCAL_RELAY ? [one(`${LOCAL_RELAY}?url=${enc}`, LOCAL_RELAY_HEADERS)] : []),
  ]);
  const at = j.manage.firstAdvertisedDateTime || j.manage.registDateTime;
  return { postedAt: at ? new Date(`${at}+09:00`).toISOString() : null, reserved: !!j.manage.webReserved };
}

// The highest id currently listed on Encar: the top of the recently-updated
// list, then probed upward 200 ids at a time until nothing more exists.
async function topListedId(signal) {
  const first = await runSearch([], 0, 500, signal);
  let top = Math.max(...first.SearchResults.map(c => c.Id));
  // Probe 1,000 ids above at once (5 queries in parallel); repeat while the
  // highest block still had cars in it.
  for (let k = 0; k < 4; k++) {
    const blocks = await Promise.all([0, 1, 2, 3, 4].map(b =>
      runSearch([idGroup(top + (b + 1) * ID_CHUNK, top + b * ID_CHUNK + 1)], 0, ID_CHUNK, signal).catch(() => null)));
    const ids = blocks.flatMap(d => d?.SearchResults?.map(c => c.Id) ?? []);
    if (!ids.length) break;
    top = Math.max(top, ...ids);
    if (!blocks[4]?.SearchResults?.length) break;
  }
  return top;
}

/**
 * Newest listings matching `parts`, newest first. Either everything above
 * `sinceId` (an incremental feed: pass back the previous response's
 * latestId), or everything first advertised within the last `hours`.
 */
async function newestFeed(parts, { sinceId, hours }, offset, count, signal) {
  const top = await topListedId(signal);
  const MAX_IDS = 4000;                  // ~8h of Encar registrations
  const floor = sinceId ? Math.max(sinceId + 1, top - MAX_IDS) : top - MAX_IDS;
  const cutoff = hours ? Date.now() - hours * 3600e3 : null;
  const rows = [];
  let hi = top, reachedCutoff = false;
  while (hi >= floor && !reachedCutoff) {
    const round = [];
    for (let i = 0; i < 16 && hi >= floor; i++, hi -= ID_CHUNK) {
      round.push(runSearch([...parts, idGroup(hi, Math.max(floor, hi - ID_CHUNK + 1))], 0, ID_CHUNK, signal));
    }
    const found = (await Promise.all(round)).flatMap(d => d.SearchResults);
    rows.push(...found);
    if (cutoff && found.length) {
      const lowest = found.reduce((a, b) => (a.Id < b.Id ? a : b));
      const t = Date.parse((await readside(lowest.Id, signal)).postedAt);
      if (t < cutoff) reachedCutoff = true;
    }
  }
  const seen = new Set();
  let list = rows.filter(c => !seen.has(c.Id) && seen.add(c.Id)).sort((a, b) => b.Id - a.Id);
  if (cutoff && reachedCutoff) {
    // Exact boundary: binary search the posting time over the sorted ids.
    let lo = 0, hiIx = list.length - 1, keep = list.length;
    while (lo <= hiIx) {
      const mid = (lo + hiIx) >> 1;
      const t = Date.parse((await readside(list[mid].Id, signal)).postedAt);
      if (t >= cutoff) lo = mid + 1; else { keep = mid; hiIx = mid - 1; }
    }
    list = list.slice(0, keep);
  }
  return { Count: list.length, SearchResults: list.slice(offset, offset + count), latestId: top };
}

/**
 * Cars whose price dropped within the last `days`, re-read live and still
 * at or below the reduced price, most recent drop first. Each call also
 * sweeps Encar's recently-updated listings, which is where a price change
 * shows up, so new drops are caught as they happen.
 */
async function priceDropFeed(parts, days, offset, count, signal) {
  // Earlier prices from the search cache (once), then the next block of
  // those cars re-read live: a car now cheaper than it was cached is a drop.
  await seedFromCache().catch(() => {});
  const seedIds = await nextSeedIds(1600).catch(() => []);
  const seedBlocks = [];
  for (let i = 0; i < seedIds.length; i += ID_CHUNK) seedBlocks.push(seedIds.slice(i, i + ID_CHUNK));
  // Swept with the caller's own filters, so it watches the cars they asked about.
  const [sweep, seeded] = await Promise.all([
    Promise.all([0, 500, 1000, 1500].map(o => runSearch(parts, o, 500, signal).catch(() => null))),
    Promise.all(seedBlocks.map(b => runSearch([`(Or.${b.map(i => `CarId.${i}.`).join('_.')})`], 0, ID_CHUNK, signal).catch(() => null))),
  ]);
  await trackPrices([...sweep, ...seeded].filter(Boolean).flatMap(d => d.SearchResults));
  const ids = await recentDropIds(Date.now() - days * 86400e3);
  if (ids === null) throw new Error('price tracking unavailable');
  const chunks = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const found = (await Promise.all(chunks.map(ch =>
    runSearch([...parts, `(Or.${ch.map(i => `CarId.${i}.`).join('_.')})`], 0, ID_CHUNK, signal)))).flatMap(d => d.SearchResults);
  const annotated = (await trackPrices(found)).filter(c => c.priceDrop);
  annotated.sort((a, b) => Date.parse(b.priceDrop.droppedAt) - Date.parse(a.priceDrop.droppedAt));
  return { Count: annotated.length, SearchResults: annotated.slice(offset, offset + count), tracked: true };
}

/**
 * Listing counts from Encar's facet tree, for the caller's filters:
 * per make when no make is given, per model for a make, per generation for
 * a model. One Encar query (two for a make: domestic and import trees).
 */
async function facetCounts(make, liveModel, commonParts, signal) {
  if (liveModel?.modelGroup) {
    const d = await rawSearch([...commonParts, `(C.Manufacturer.${liveModel.make}._.ModelGroup.${liveModel.modelGroup}.)`], 0, 1, signal);
    return { total: d.Count, manufacturer: liveModel.make, modelGroup: liveModel.modelGroup,
      generations: modelsFrom(d.iNav, true).filter(m => m.count > 0).map(m => ({ model: m.value, count: m.count })).sort((a, b) => b.count - a.count) };
  }
  if (make) {
    const trees = await Promise.all(['Y', 'N'].map(t =>
      rawSearch([...commonParts, `(C.CarType.${t}._.Manufacturer.${make}.)`], 0, 1, signal).catch(() => null)));
    const models = trees.flatMap(d => modelGroupsFrom(d?.iNav, true)).filter(m => m.count > 0);
    return { total: trees.reduce((n, d) => n + (d?.Count || 0), 0), manufacturer: make,
      models: models.map(m => ({ model: m.value, modelEn: m.eng, count: m.count })).sort((a, b) => b.count - a.count) };
  }
  // Encar lists makes only inside the domestic (Y) and import (N) trees.
  const trees = await Promise.all(['Y', 'N'].map(t =>
    rawSearch([...commonParts, `CarType.${t}`], 0, 1, signal).catch(() => null)));
  return { total: trees.reduce((n, d) => n + (d?.Count || 0), 0),
    manufacturers: trees.flatMap(d => manufacturersFrom(d?.iNav)).filter(m => m.count > 0).sort((a, b) => b.count - a.count) };
}

async function rawSearch(parts, offset, count, signal, sortKey = 'ModifiedDate') {
  const encarUrl = buildEncarUrl(parts, offset, count, sortKey);
  const enc = encodeURIComponent(encarUrl);

  return Promise.any([
    attempt(encarUrl,                                          false, signal, 'direct',    BROWSER_HEADERS),
    attempt(`https://api.allorigins.win/get?url=${enc}`,       true,  signal, 'allorigins', {}),
    attempt(`https://api.codetabs.com/v1/proxy?quest=${enc}`,  false, signal, 'codetabs',   {}),
    // corsproxy.io now rejects server-side callers outright ("Server-side
    // requests are not allowed on your plan") — permanently dead for this
    // use case, not a transient outage, so dropped in favor of cors.lol
    // (verified live 2026-08-20: returns real Encar data, though its own
    // per-caller rate limit kicks in fast under repeat traffic — still a
    // net-positive extra attempt in this race, not a guaranteed hit).
    attempt(`https://api.cors.lol/?url=${enc}`,                false, signal, 'corslol',   {}),
    // Own relay, not rate-limited by other callers — see DENO_RELAY comment above.
    attempt(`${DENO_RELAY}?url=${enc}`,                        false, signal, 'denorelay', DENO_RELAY_HEADERS),
    // Residential egress, added only when configured (see LOCAL_RELAY above).
    ...(LOCAL_RELAY
      ? [attempt(`${LOCAL_RELAY}?url=${enc}`,                  false, signal, 'localrelay', LOCAL_RELAY_HEADERS)]
      : []),
  ]);
}

// Last-resort fallback for free text that doesn't map onto an exact Encar
// facet value (e.g. "1 Series", "Ser", or any other partial/loose term):
// scan a broad recent batch and rank whatever actually contains the words
// typed, instead of dead-ending with zero results.
function tokenize(str) {
  return (str || '').toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);
}

// A term that PREFIXES a model token (e.g. "x" -> "x5") is what the user
// means by a partial model code; a term that just happens to appear
// mid-token (e.g. "x" inside the generation code "nx4") is much weaker
// signal and should rank below real matches, not disappear, since we'd
// rather over- than under-include.
//
// Badge/trim text (otherTokens) only ever ADDS to an already-qualified
// score, never qualifies a car on its own — otherwise a common trim badge
// shared across an entire lineup (e.g. "AMG Line" appears on the vast
// majority of current Mercedes C/E/GLC/GLE-Class listings) makes searching
// for an unrelated model that merely shares a word with that badge (e.g.
// "AMG GT") discover the whole lineup as "matching variants". Each
// discovered variant gets its own live re-query in substringSearch, so
// that false-positive flood was blowing past the request timeout — this
// requires at least one term to hit the car's own Model field first.
function matchScore(car, terms) {
  const modelTokens = tokenize(car.Model);
  const otherTokens = [...tokenize(car.Manufacturer), ...tokenize(car.Badge), ...tokenize(car.BadgeDetail)];
  let score = 0;
  let modelHit = false;
  for (const t of terms) {
    if (modelTokens.some(tok => tok === t))            { score += 100; modelHit = true; }
    else if (modelTokens.some(tok => tok.startsWith(t))) { score += 50; modelHit = true; }
    else if (otherTokens.some(tok => tok.startsWith(t))) score += 10;
    else if ([...modelTokens, ...otherTokens].some(tok => tok.includes(t))) score += 1;
  }
  return modelHit ? score : 0;
}

// Encar attaches a generation-code suffix to almost every Model facet value
// (e.g. BMW 7 Series is never bare "7시리즈" — it's "7시리즈 (E65)",
// "7시리즈 (F01)", "7시리즈 (G11)", "7시리즈 (G70)"), so an exact-match model
// filter on the plain name always returns zero. This used to fall back to
// sampling just the 500 most-recently-modified listings and keyword-scoring
// them — which badly undercounts anything but the newest slice of a large,
// popular, multi-generation model (verified live: BMW 7 Series showed ~40
// cars this way vs 1000+ real listings on Encar itself). Fixed two-phase:
// (1) scan a sample to discover every distinct real Model string that
// contains the search term, then (2) re-query each discovered value as its
// own exact Encar facet filter to get a true per-variant Count and a real
// page of backing rows, instead of guessing from a small sample.
// Coupé / cabrio / wagon are not Encar categories (see bodyType.js), so they
// are found by reading the model/trim text of live rows: the newest
// BODY_SCAN_ROWS listings matching every other filter are fetched in parallel
// pages and kept when their text names the body. When that window does not
// cover the whole result set, the total is extrapolated from it and flagged
// `totalApprox` rather than presented as exact.
const BODY_SCAN_PAGE  = 500;  // Encar's largest working page (1000 returns nothing)
const BODY_SCAN_BATCH = 4;    // pages fetched in parallel per round
const BODY_SCAN_MAX   = 8000; // rows; bounds one request's work for deep pages

async function bodyScan(parts, texts, cats, offset, count, signal, sortKey) {
  const first = await runSearch(parts, 0, BODY_SCAN_PAGE, signal, sortKey);
  const limit = Math.min(first.Count, BODY_SCAN_MAX);
  const rowsSeen = [...first.SearchResults];
  let matches = rowsSeen.filter(c => textBody(c, texts));

  // Keep reading further into the result set until the requested page is
  // filled, so scrolling deeper keeps returning coupés instead of stopping at
  // the end of a fixed window.
  let next = BODY_SCAN_PAGE;
  while (matches.length < offset + count && next < limit) {
    const batch = [];
    for (let i = 0; i < BODY_SCAN_BATCH && next < limit; i++, next += BODY_SCAN_PAGE) {
      batch.push(runSearch(parts, next, BODY_SCAN_PAGE, signal, sortKey).catch(() => null));
    }
    for (const p of await Promise.all(batch)) if (p) rowsSeen.push(...p.SearchResults);
    matches = rowsSeen.filter(c => textBody(c, texts));
  }
  const scanned = rowsSeen.length;

  const exact = scanned >= first.Count;
  let total = exact ? matches.length : Math.round(matches.length / Math.max(1, scanned) * first.Count);
  let rows  = matches.slice(offset, offset + count);

  // A category body chosen alongside (e.g. SUV + Coupé) comes from its own
  // exact Encar query, page for page, merged without duplicates.
  if (cats.length) {
    const cat = await runSearch([...parts, categoryPart(cats)], offset, count, signal, sortKey);
    const seen = new Set(rows.map(c => c.Id));
    rows  = [...rows, ...cat.SearchResults.filter(c => !seen.has(c.Id))];
    total += cat.Count;
    if (sortKey === 'PriceAsc')  rows.sort((a, b) => (a.Price ?? 0) - (b.Price ?? 0));
    if (sortKey === 'PriceDesc') rows.sort((a, b) => (b.Price ?? 0) - (a.Price ?? 0));
  }
  return { Count: total, SearchResults: rows, approx: !exact };
}

async function substringSearch(keyword, manufacturer, offset, count, signal, extraParts = [], sortKey = 'ModifiedDate') {
  const scanParts = [...(manufacturer ? [`Manufacturer.${manufacturer}`] : []), ...extraParts];

  // Split with the same rule matchScore uses on car fields (tokenize), so a
  // hyphenated term like "C-CLASS" lines up with Encar's "C-클래스" split
  // into ["c","클래스"] instead of staying one unmatchable "c-class" blob.
  // Short tokens (e.g. the "c" in "c-class", or "x" meant to catch X3/X5/X6)
  // are kept rather than dropped as noise — matchScore already ranks an
  // exact short-token match (tier 1, score 100) above a mid-token coincidence
  // (tier 4, score 1), so keeping them only helps precision here.
  const useTerms = tokenize(keyword);

  // Discovery must never depend on the caller's requested sortKey — a
  // specific model's listings aren't evenly spread across price or recency
  // within a brand-wide sample (e.g. a flagship like the 7 Series is
  // under-represented among the 1000 *cheapest* BMWs overall, which skew
  // toward smaller/older models), so scanning with only one sort order
  // discovers a different, incomplete subset of generation variants and the
  // resulting total silently changes with the sort dropdown. Scanning from
  // three different angles in parallel and merging what each finds gives a
  // stable, sort-independent set of real variants.
  const discoveryScans = await Promise.all(
    ['ModifiedDate', 'PriceAsc', 'PriceDesc'].map(s => runSearch(scanParts, 0, 1000, signal, s).catch(() => null))
  );

  // Discover the distinct real Model facet strings the term actually
  // matches, keeping the best score seen for each (used for relevance sort
  // on the "most recent" path, where there's no price to sort by instead).
  const variantScores = new Map();
  for (const scan of discoveryScans) {
    if (!scan) continue;
    for (const car of scan.SearchResults) {
      const score = matchScore(car, useTerms);
      if (score > 0 && score > (variantScores.get(car.Model) ?? -1)) {
        variantScores.set(car.Model, score);
      }
    }
  }

  if (variantScores.size === 0) {
    return { Count: 0, SearchResults: [] };
  }

  // A generic short token (e.g. "e", meant to catch things like BMW's
  // E90/E46/E39-style chassis codes) can coincidentally prefix-match dozens
  // of unrelated Model variants across an entire brand's lineup — verified
  // live with a stray Albanian article ("e" from "e kuqe"/red) discovering
  // 50+ distinct BMW generations. Each variant below fires its own 4-way
  // proxy fan-out, so an unbounded discovery set blows past the request
  // timeout. Keep only the highest-scoring variants — genuine matches (tier
  // 1/2, scored 50-100) always survive a cap this size; it's only the long
  // tail of weak coincidental hits that gets dropped.
  const MAX_VARIANTS = 20;
  const rankedVariants = variantScores.size <= MAX_VARIANTS
    ? variantScores
    : new Map([...variantScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VARIANTS));

  // Each discovered variant gets its own real exact-facet query (in
  // parallel) so its Count and rows come straight from Encar, not a sample.
  const variantResults = await Promise.all(
    [...rankedVariants.entries()].map(async ([modelValue, score]) => {
      try {
        const data = await runSearch([...scanParts, `Model.${modelValue}`], 0, 1000, signal, sortKey);
        return { score, data };
      } catch {
        return null;
      }
    })
  );

  let totalCount = 0;
  const rows = [];
  for (const v of variantResults) {
    if (!v) continue;
    totalCount += v.data.Count;
    for (const car of v.data.SearchResults) rows.push({ car, score: v.score });
  }

  // A price sort was explicitly requested — it should win over relevance
  // ranking for the matched set, same as it does on the plain-filter path.
  if (sortKey === 'PriceAsc')       rows.sort((a, b) => (a.car.Price ?? 0) - (b.car.Price ?? 0));
  else if (sortKey === 'PriceDesc') rows.sort((a, b) => (b.car.Price ?? 0) - (a.car.Price ?? 0));
  else                              rows.sort((a, b) => b.score - a.score);

  return {
    Count:         totalCount,
    SearchResults: rows.slice(offset, offset + count).map(x => x.car),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!req.keyChecked) {
    if (!await checkApiKey(req, res)) return;
    req.keyChecked = true;
  }
  // A live-only key runs the rest of the request with noise checking on
  // (see runSearch). Re-entering skips the key check above, so it is
  // counted once.
  if (req.liveOnly && !liveStore.getStore()) {
    return liveStore.run({ clean: true }, () => handler(req, res));
  }

  const q = req.query;

  // A throttled paid key (see rateLimit.js's PAID_API_KEYS maxCount field)
  // gets a lower ceiling here than the site-wide default of 500.
  const countCap = req.paidMaxCount ?? 500;

  const page   = Math.max(0, parseInt(q.page  ?? '0'));
  const count  = Math.min(countCap, Math.max(1, parseInt(q.count ?? '24')));
  const offset = page * count;

  // Identity filter (manufacturer/model) — kept separate from the rest so we
  // can retry with a looser filter if the exact combo comes back empty.
  const rawKeyword = (q.q || q.keyword || q.search || '').trim();
  let manufacturer = null;
  let model        = null;
  let remainder    = null; // raw leftover text, used only by the substring fallback
  let modelExact   = false; // true only for a confirmed MODEL_REVERSE dictionary hit

  if (rawKeyword) {
    const parsed = parseKeyword(rawKeyword);
    manufacturer = parsed.manufacturer || null;
    model        = parsed.model        || null;
    remainder    = parsed.remainder    || null;
    modelExact   = !!parsed.modelExact;
  } else {
    if (q.manufacturer) manufacturer = toEncarManufacturer(q.manufacturer);
    if (q.model) {
      model      = toEncarModel(q.model);
      modelExact = isExactEncarModel(q.model);
      // Use the transliterated value (not the raw English dropdown text) as
      // the substring-fallback term — it tokenizes against Encar's raw
      // Hangul/passthrough-code fields, unlike an English word like "series".
      remainder = model;
    }
  }

  // Live-only key: the model -- model=, modelGroup=, or the words after the
  // make in q= -- is resolved against Encar's live model list onto exact
  // ModelGroup/Model filters. No match means no cars, never the whole make.
  let liveModel = null;
  if (req.liveOnly) {
    let make = q.manufacturer ? toEncarManufacturer(q.manufacturer) : null;
    let text = (q.modelGroup || q.model || '').trim();
    if (!text && rawKeyword) {
      const split = splitMake(rawKeyword);
      make = make || split.make;
      text = split.rest;
      if (!text) { manufacturer = make; model = null; remainder = null; }
    }
    if (text) {
      const r = await resolveModel(make, text, AbortSignal.timeout(6000)).catch(() => null);
      if (!r) {
        res.setHeader('Retry-After', '30');
        return res.status(503).json({ error: 'Live data is momentarily unavailable. Retry shortly.', code: 'LIVE_UNAVAILABLE', live: false });
      }
      if (r.unknown) {
        const fetchedAt = new Date().toISOString();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          total: 0, page, count: 0, results: [], live: true, fetchedAt,
          modelMatched: false,
          notice: `No Encar model matches "${text}"${make ? ' for this make' : ''}.`,
          knownModels: r.known,
        });
      }
      liveModel = r;
      manufacturer = r.make; model = null; remainder = null; modelExact = false;
    }
  }

  // Encar's own sort keys (verified 2026-10-02). It has model year newest
  // first, but no oldest-first.
  const SORTS = { priceAsc: 'PriceAsc', priceDesc: 'PriceDesc', yearDesc: 'Year', mileageAsc: 'MileageAsc', mileageDesc: 'MileageDesc' };
  const sortKey = SORTS[q.sort] ?? 'ModifiedDate';

  // Filters shared by every attempt (fuel/year/mileage/price/transmission/color)
  const commonParts = [];

  // Encar files hybrids and LPG under combined values ("가솔린+전기",
  // "LPG(일반인 구입)"), so for live-only keys those words cover all of them.
  const LIVE_FUELS = {
    hybrid: ['가솔린+전기', '디젤+전기', 'LPG+전기'],
    lpg:    ['LPG(일반인 구입)', 'LPG+전기', '가솔린+LPG', 'LPG+가솔린'],
  };
  if (q.fuel) {
    const key = q.fuel.toLowerCase().trim();
    const group = req.liveOnly ? LIVE_FUELS[key] : null;
    if (group) commonParts.push(`(Or.${group.map(v => `FuelType.${v}.`).join('_.')})`);
    else commonParts.push(`FuelType.${FUEL_MAP[key] ?? q.fuel}`);
  }

  if (q.transmission) {
    const mapped = TRANSMISSION_MAP[q.transmission.toLowerCase().trim()] ?? q.transmission;
    commonParts.push(`Transmission.${mapped}`);
  }

  if (q.color) {
    // Albanian color words carry a gender article ("e kuqe", "e bardhe") that
    // dictionary keys omit (ekuqe, ebardhe) — strip spaces before matching so
    // the natural-language form isn't silently treated as an unknown color.
    const normalized = q.color.toLowerCase().replace(/\s+/g, '').trim();
    const mapped = COLOR_MAP[normalized] ?? q.color;
    commonParts.push(`Color.${mapped}`);
  }

  // Always applied (not just when yearFrom/yearTo are set) so the MIN_YEAR
  // floor takes effect on every default, unfiltered browse too — matches
  // the MIN_PRICE_MANWON floor below.
  {
    // Year field is YYYYMM (e.g. 201405), so convert 4-digit year to 6-digit range
    const yearFrom = Math.max(MIN_YEAR, parseInt(q.yearFrom) || MIN_YEAR);
    const from = yearFrom + '00';
    const to   = (q.yearTo ?? '2030') + '99';
    commonParts.push(`Year.range(${from}..${to})`);
  }

  if (q.mileageFrom || q.mileageTo) {
    commonParts.push(`Mileage.range(${q.mileageFrom ?? 0}..${q.mileageTo ?? 9999999})`);
  }

  // Always applied (not just when priceFrom/priceTo are set) so the minimum
  // floor below takes effect on every default, unfiltered browse too.
  const priceFromManwon = q.priceFrom ? eurToManwon(q.priceFrom) : 0;
  const priceToManwon   = q.priceTo   ? eurToManwon(q.priceTo)   : 999999;
  commonParts.push(`Price.range(${Math.max(MIN_PRICE_MANWON, priceFromManwon)}..${priceToManwon})`);

  // Body type: SUV/Sedan/... are Encar categories and filter server-side like
  // any other facet; Coupé/Cabrio/Wagon need the text scan (bodyScan). An
  // unknown value is refused -- answering it with unfiltered cars would look
  // like a working filter that returns the wrong body.
  const bodies = parseBodies(q.body);
  if (bodies.unknown.length) {
    return res.status(400).json({
      error: `Unknown body type: ${bodies.unknown.join(', ')}`,
      accepted: BODY_VALUES,
    });
  }
  const bodyRequested = bodies.cats.length + bodies.texts.length > 0;

  // Feeds, live-only keys: sort=newest (postedWithin=<hours> | newSince=<id>)
  // and priceDropped=1 (droppedWithin=<days>). See newestFeed/priceDropFeed.
  const feedMode = !req.liveOnly ? null
    : (q.priceDropped === '1' || q.priceDropped === 'true') ? 'priceDropped'
    : (q.sort === 'newest' || q.newSince) ? 'newest' : null;
  const newSince      = parseInt(q.newSince, 10) || null;
  // Capped at 6 hours: one parallel round of id blocks. For anything polled
  // regularly, newSince (the previous response's latestId) costs 1-3 queries.
  const postedWithin  = newSince ? null : Math.min(6, Math.max(0.25, parseFloat(q.postedWithin) || 6));
  const droppedWithin = Math.min(30, Math.max(1, parseFloat(q.droppedWithin) || 7));
  const bodyScanMode  = bodies.texts.length > 0;
  if (bodies.cats.length && !bodyScanMode) commonParts.push(categoryPart(bodies.cats));
  // The body each returned car is listed as: its own coupé/cabrio/wagon text
  // first, else the one category asked for.
  const bodyOf = (car) => {
    const t = textBody(car);
    if (t) return BODY_LABELS[t];
    return bodies.cats.length === 1 ? BODY_LABELS[bodies.cats[0]] : null;
  };

  // Only a confirmed dictionary hit is trustworthy as an *exact* Model facet —
  // Encar stores everything else (series/class/code-style names) with a
  // generation-code suffix, so an exact filter on those either goes empty or
  // (worse) returns a small, misleadingly "successful" sliver of real matches
  // (e.g. only the one Audi listing literally tagged "A4" with no suffix).
  const identityParts = [];
  if (liveModel) identityParts.push(...liveModel.parts);
  else {
    if (manufacturer) identityParts.push(`Manufacturer.${manufacturer}`);
    if (model && modelExact) identityParts.push(`Model.${model}`);
  }

  // A blocked `direct` attempt hangs rather than fails fast (confirmed live:
  // ~10s round trips from prod), so this timeout is the real ceiling on
  // every request's latency, not just a safety net — kept short so a
  // failing live attempt falls through to the cors.lol/cache race quickly
  // instead of visitors staring at a spinner for 9+ seconds.
  const cacheKey = cacheKeyFromQuery('autovg:cache:cars', q);

  // Cache-first: a query answered in the last FRESH_WINDOW_MS is served
  // straight from Redis, no live Encar/proxy attempt at all. See
  // serverCache.js for why.
  // A live-only key (a trial key, see freeKeys.js) never touches the cache:
  // every answer is fetched from Encar for this request, or the request fails.
  const freshCached = req.liveOnly ? null : await cacheGet(cacheKey);
  if (freshCached && Date.now() - freshCached.ts < FRESH_WINDOW_MS) {
    return res.status(200).json({
      total:   freshCached.total,
      page,
      count:   freshCached.results.length,
      results: freshCached.results.map(c => ({ ...withPower(c), bodyType: bodyOf(c) })),
    });
  }

  const ctrl  = new AbortController();
  // A live-only key has no cache to fall back on, so it gets most of the
  // function's 10s budget to reach Encar instead of the visitor's 3s.
  // The newest/price-drop feeds read many id blocks, so they get longer still.
  const timer = setTimeout(() => ctrl.abort(), feedMode ? 25000 : req.liveOnly ? 8000 : 3000);

  try {
    // Plain unfiltered homepage browsing — no brand/model/keyword narrowing
    // at all. A single "most recent 24" page is almost always pure
    // Hyundai/Kia (they dominate raw listing volume), so reranking that tiny
    // page by qualityScore never gives the featured German brands a real
    // chance to surface. Only the very first FEATURED_COUNT slots on the
    // very first page are curated this way — everything after that
    // (including the rest of this same page, and every later page) is
    // plain chronological order, untouched.
    const isPlainBrowse = !req.liveOnly && sortKey === 'ModifiedDate' && identityParts.length === 0 && !rawKeyword;
    let data;
    if (req.liveOnly && (q.facets === '1' || q.facets === 'true')) {
      clearTimeout(timer);
      const fetchedAt = new Date().toISOString();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Data-Live', 'true');
      res.setHeader('X-Data-Fetched-At', fetchedAt);
      return res.status(200).json({ live: true, fetchedAt,
        ...(await facetCounts(manufacturer, liveModel, commonParts, ctrl.signal)) });
    }
    if (feedMode) {
      // Coupé/Cabrio/Wagon are trim-text matches, applied to the feed's rows.
      const keepBody = (r) => (bodies.texts.length
        ? { ...r, SearchResults: r.SearchResults.filter(c => textBody(c, bodies.texts)) } : r);
      data = keepBody(feedMode === 'newest'
        ? await newestFeed([...identityParts, ...commonParts], { sinceId: newSince, hours: postedWithin }, offset, count, ctrl.signal)
        : await priceDropFeed([...identityParts, ...commonParts], droppedWithin, offset, count, ctrl.signal));
    } else if (bodyScanMode) {
      data = await bodyScan([...identityParts, ...commonParts], bodies.texts, bodies.cats, offset, count, ctrl.signal, sortKey);
    } else if (isPlainBrowse && offset === 0) {
      const pool = await runSearch(commonParts, 0, FEATURED_POOL_SIZE, ctrl.signal, sortKey);
      const featured = pool.SearchResults
        .map((car, i) => ({ car, i, s: qualityScore(car) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map(x => x.car)
        .slice(0, FEATURED_COUNT);
      const featuredIds = new Set(featured.map(c => c.Id));
      const rest = pool.SearchResults.filter(c => !featuredIds.has(c.Id));
      data = { Count: pool.Count, SearchResults: [...featured, ...rest].slice(0, count) };
    } else {
      data = await runSearch([...identityParts, ...commonParts], offset, count, ctrl.signal, sortKey);
    }

    // A non-exact model was left out of the facet filter above — narrow the
    // (brand-wide) results down by substring-matching it now, rather than
    // waiting for a hard zero-result before trying.
    if (!feedMode && !bodyScanMode && model && !modelExact) {
      const narrowed = await substringSearch(remainder, manufacturer, offset, count, ctrl.signal, commonParts, sortKey);
      if (narrowed.SearchResults.length > 0) data = narrowed;
    }

    // Still nothing matched — progressively broaden instead of dead-ending
    // with zero results:
    //   1. Brand recognized + leftover text ("BMW X" / "BMW X5") → scan that
    //      brand's recent listings for the leftover text (catches X3/X5/X6...).
    //   2. Still nothing but brand is known → show the whole brand.
    //   3. No brand recognized at all ("X5", "X", "1 Series", "Ser") → scan
    //      everything for the typed text.
    //   4. Truly nothing matched anywhere → show recent listings rather than
    //      a hard empty state.
    // Never for a coupé/cabrio/wagon search: broadening would hand back cars
    // of some other body as if they matched.
    // Nor for a resolved model: zero of that model is the answer, not the make.
    if (!feedMode && !bodyScanMode && !liveModel && data.SearchResults.length === 0 && (manufacturer || model)) {
      if (manufacturer && remainder) {
        data = await substringSearch(remainder, manufacturer, offset, count, ctrl.signal, commonParts, sortKey);
      }
      if (data.SearchResults.length === 0 && manufacturer) {
        data = await runSearch([`Manufacturer.${manufacturer}`, ...commonParts], offset, count, ctrl.signal, sortKey);
      }
      if (data.SearchResults.length === 0 && !manufacturer) {
        data = await substringSearch(rawKeyword, null, offset, count, ctrl.signal, commonParts, sortKey);
      }
      if (data.SearchResults.length === 0) {
        data = await runSearch(commonParts, offset, count, ctrl.signal, sortKey);
      }
    }

    clearTimeout(timer);

    // Only re-rank the default (newest-first) browse — an explicit price
    // sort from the user is a stronger, deliberate signal and must win.
    const results = !feedMode && !req.liveOnly && sortKey === 'ModifiedDate'
      ? data.SearchResults.map((car, i) => ({ car, i, s: qualityScore(car) }))
          .sort((a, b) => b.s - a.s || a.i - b.i)
          .map(x => x.car)
      : data.SearchResults;

    // Best-effort — never let a cache-write failure affect the live response.
    if (results.length > 0 && !req.liveOnly) await cacheSet(cacheKey, { total: data.Count, results });
    // Live-only: every price seen is recorded, so a later lower price is a
    // detected drop; rows with a known drop carry priceDrop.
    const finalRows = req.liveOnly ? await trackPrices(results) : results;

    const fetchedAt = new Date().toISOString();
    if (req.liveOnly) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Data-Live', 'true');
      res.setHeader('X-Data-Fetched-At', fetchedAt);
    }

    return res.status(200).json({
      total:   data.Count,
      ...(data.approx ? { totalApprox: true } : {}),
      page,
      count:   results.length,
      results: finalRows.map(c => ({ ...withPower(c), bodyType: bodyOf(c) })),
      ...(feedMode === 'newest' ? { latestId: data.latestId, ...(postedWithin ? { postedWithin } : { newSince }) } : {}),
      ...(feedMode === 'priceDropped' ? { droppedWithin } : {}),
      ...(req.liveOnly ? { live: true, fetchedAt } : {}),
      ...(liveModel ? { modelMatched: true, resolved: { manufacturer: liveModel.make, modelGroup: liveModel.modelGroup, model: liveModel.model } } : {}),
    });

  } catch (err) {
    clearTimeout(timer);
    const isTimeout = ctrl.signal.aborted;
    const detail    = err instanceof AggregateError
      ? err.errors.map(e => e.message).join(' | ')
      : err.message;

    // Live-only key: no cached, stale or unfiltered substitute, ever.
    if (req.liveOnly) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Live data is momentarily unavailable. Retry shortly.',
        code:  'LIVE_UNAVAILABLE',
        live:  false,
      });
    }

    // Live fetch (direct + every proxy) failed — serve the last-known-good
    // response for this exact query, if any visitor has ever gotten one,
    // instead of a hard error. Still marked `stale` so the UI can say so.
    // Reuses the freshCached lookup from above (already fetched, just too
    // old to skip the live attempt) instead of hitting Redis again.
    const cached = freshCached ?? await cacheGet(cacheKey);
    if (cached) {
      // These cars DO match the requested filters -- they are only old -- so
      // the status stays 200 and the caller keeps usable data.
      //
      // Omitting retryFromBrowser here was the bug that froze a cached query
      // at whatever day it was last warmed. src/lib/api.js only upgrades a
      // response carrying that URL, so this branch -- the one serving every
      // query anyone has ever run -- could never recover, while the rarer
      // unfiltered branch below could. A browser client therefore sat on
      // 13-day-old listings and never retried, which is what a paid
      // integrator hit on 2026-09-19.
      staleHeaders(res, cached.ts);
      return res.status(200).json({
        total:    cached.total,
        page,
        count:    cached.results.length,
        results:  cached.results.map(withPower),
        stale:    true,
        cachedAt: cached.ts,
        filtersApplied: true,
        retryFromBrowser: buildEncarUrl(
          [...identityParts, ...commonParts],
          offset,
          count,
          sortKey,
        ),
        detail,
      });
    }

    // BRAND FALLBACK, before the unfiltered one below.
    //
    // Cache keys are the whole query string, so manufacturer=BMW&count=200
    // and manufacturer=BMW&count=200&yearFrom=2016 are different entries and
    // only one of them may be warm. Dropping straight to the unfiltered cache
    // in that case answers a request for BMWs with Audis and Benzes -- flagged
    // filtersApplied:false, but a caller checking makes rather than flags just
    // sees wrong cars and concludes the API is broken.
    //
    // A warm brand entry answers those neighbouring shapes correctly: same
    // make, filtered in-process for whatever else the caller asked that can be
    // evaluated here (year and price live on the car objects). Only the
    // manufacturer is required to match; anything unmatched simply narrows.
    // Not for a body search: the brand cache holds every body type.
    if (q.manufacturer && !bodyRequested) {
      const brandKey = cacheKeyFromQuery('autovg:cache:cars', {
        page: '0', count: '200', yearFrom: '2016', manufacturer: q.manufacturer,
      });
      const brand = await cacheGet(brandKey).catch(() => null);
      if (brand?.results?.length) {
        const kr = MANUFACTURER_REVERSE[q.manufacturer] || q.manufacturer;
        const yFrom = q.yearFrom ? parseInt(q.yearFrom, 10) * 100 : null;
        const yTo   = q.yearTo   ? parseInt(q.yearTo,   10) * 100 + 99 : null;
        const pFrom = q.priceFrom ? Number(q.priceFrom) : null;
        const pTo   = q.priceTo   ? Number(q.priceTo)   : null;

        const matched = brand.results.filter(c => {
          if (c.Manufacturer !== kr && c.Manufacturer !== q.manufacturer) return false;
          const y = Number(c.Year), p = Number(c.Price);
          if (yFrom != null && Number.isFinite(y) && y < yFrom) return false;
          if (yTo   != null && Number.isFinite(y) && y > yTo)   return false;
          if (pFrom != null && Number.isFinite(p) && p < pFrom) return false;
          if (pTo   != null && Number.isFinite(p) && p > pTo)   return false;
          return true;
        });

        // An empty match must never be served: a blank grid is worse than
        // stale cars, so that case falls through to the unfiltered branch
        // exactly as before.
        if (matched.length > 0) {
          const sliced = matched.slice(offset, offset + Math.max(1, count));
          if (sliced.length > 0) {
            staleHeaders(res, brand.ts);
            return res.status(200).json({
              total:    matched.length,
              page,
              count:    sliced.length,
              results:  sliced.map(withPower),
              stale:    true,
              cachedAt: brand.ts,
              filtersApplied: true,
              servedFrom: 'brand-cache',
              retryFromBrowser: buildEncarUrl(
                [...identityParts, ...commonParts],
                offset,
                count,
                sortKey,
              ),
              detail,
            });
          }
        }
      }
    }

    // LAST RESORT: the exact query has no cache entry, and every proxy is
    // down. Rather than return nothing, fall back to the unfiltered cache --
    // the entry the homepage populates, which is the one query that is always
    // warm.
    //
    // Why this exists: on 2026-09-14 Encar's CloudFront began blocking the
    // Deno relay's egress (403 "Request blocked. Generated by cloudfront")
    // while allorigins/codetabs/corslol were simultaneously 522/522/429. The
    // site itself kept working -- GET /api/cars returned 157,489 cars from
    // cache -- but any query nobody had run before 11 September fell straight
    // through to this branch and 504'd. An integrator testing `q=bmw x5`
    // concluded the whole API was dead while the homepage was serving fine.
    //
    // The filters CANNOT be honoured from this entry, so this is flagged
    // `filtersApplied: false` and the caller is told exactly which filters
    // were dropped. Returning unfiltered cars silently would be worse than
    // the 504: a client would render them as matches for a search they do not
    // satisfy. Anything that wants strictness can check the flag and refuse.
    const fallback = await cacheGet(cacheKeyFromQuery('autovg:cache:cars', {}));
    if (fallback?.results?.length) {
      const dropped = Object.entries(q)
        .filter(([k, v]) => v !== '' && v != null && !['page', 'count'].includes(k))
        .map(([k]) => k);
      // Honour `count` even here. The first cut returned the whole cached
      // page regardless, so a caller asking for 2 got 24 -- a caller cannot
      // trust ANY field of a degraded response if the one parameter that is
      // still satisfiable is ignored.
      const sliced = fallback.results.slice(0, Math.max(1, count));

      // This response is degraded (filters dropped), and it says so in the
      // body AND now in the headers -- Warning: 110, X-Data-Stale and
      // X-Data-Cached-At, which an integrator reads without having to know
      // about our in-body flags first.
      //
      // The STATUS deliberately stays 200. Returning 503 here would be more
      // honest at the HTTP layer, but any caller that checks res.ok before
      // reading the body would render nothing, and an empty car grid is not
      // an acceptable failure mode for this site under any circumstances.
      // Headers carry the truth; the cars stay on the page.
      staleHeaders(res, fallback.ts);
      res.setHeader('Retry-After', '300');
      return res.status(200).json({
        total:    fallback.total,
        page,
        count:    sliced.length,
        results:  sliced.map(withPower),
        stale:    true,
        cachedAt: fallback.ts,
        filtersApplied: false,
        droppedFilters: dropped,
        // The browser can do what this function cannot. Encar sends
        // Access-Control-Allow-Origin: *, so a visitor fetches this URL from
        // their own connection and gets LIVE, CORRECTLY FILTERED results —
        // the client swaps them in over these cached unfiltered ones. Only
        // useful to a real browser: a server-to-server caller has no such
        // egress and should keep reading filtersApplied instead.
        retryFromBrowser: buildEncarUrl(
          [...identityParts, ...commonParts],
          offset,
          count,
          sortKey,
        ),
        notice: 'Upstream unavailable and this query was never cached. These are cached UNFILTERED listings -- they do not match the requested filters. Check filtersApplied before displaying as search results.',
        detail,
      });
    }

    // No cache to fall back on either — but the browser can still rescue this.
    //
    // A deployment with no Redis configured (the clone sites) never reaches
    // the cached branch above, so it used to return a bare 504 carrying no way
    // forward. The browser-retry URL costs nothing to include and does not
    // depend on cache existing, so it belongs on BOTH failure paths. Status
    // stays 504 because the server genuinely failed; a client that cannot act
    // on the hint is not misled.
    return res.status(isTimeout ? 504 : 502).json({
      error:  isTimeout ? 'Koha skadoi. Provo përsëri.' : 'Të gjithë proxy-t dështuan.',
      code:   isTimeout ? 'TIMEOUT' : 'ALL_FAILED',
      detail,
      retryFromBrowser: buildEncarUrl(
        [...identityParts, ...commonParts],
        offset,
        count,
        sortKey,
      ),
    });
  }
}
