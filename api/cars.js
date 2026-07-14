// Encar reverse-engineering proxy — uncapped, multi-fallback
// Supports full pagination over 200k+ listings

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

// English brand name → Korean Encar identifier
// (BMW, Audi, Porsche etc. are stored in Encar under their own name or Korean)
const MANUFACTURER_REVERSE = {
  'Hyundai':         '현대',
  'Kia':             '기아',
  'Mercedes-Benz':   '벤츠',
  'Mercedes Benz':   '벤츠',
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

// Albanian/English color → Korean Encar Color (verified live facet values,
// top ~9 by listing count covers ~96% of all live inventory)
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
};

// Case-insensitive dictionary lookup — returns the matched dictionary key, or null.
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
  const r = await fetch(fetchUrl, { signal, headers: extraHeaders });
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
  return score;
}

async function runSearch(parts, offset, count, signal, sortKey = 'ModifiedDate') {
  const allParts = ['SellType.일반', 'Condition.Inspection', ...parts];
  const filter = `(And.Hidden.N._.${allParts.join('._.')}.)`;

  const encarUrl = `https://api.encar.com/search/car/list/general?${new URLSearchParams({
    count: 'true',
    q:     filter,
    sr:    `|${sortKey}|${offset}|${count}`,
    inav:  '|Metadata|Sort',
  })}`;
  const enc = encodeURIComponent(encarUrl);

  return Promise.any([
    attempt(encarUrl,                                          false, signal, 'direct',    BROWSER_HEADERS),
    attempt(`https://api.allorigins.win/get?url=${enc}`,       true,  signal, 'allorigins', {}),
    attempt(`https://corsproxy.io/?${enc}`,                    false, signal, 'corsproxy',  {}),
    attempt(`https://api.codetabs.com/v1/proxy?quest=${enc}`,  false, signal, 'codetabs',   {}),
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
function matchScore(car, terms) {
  const modelTokens = tokenize(car.Model);
  const otherTokens = [...tokenize(car.Manufacturer), ...tokenize(car.Badge), ...tokenize(car.BadgeDetail)];
  let score = 0;
  for (const t of terms) {
    if (modelTokens.some(tok => tok === t))            score += 100;
    else if (modelTokens.some(tok => tok.startsWith(t))) score += 50;
    else if (otherTokens.some(tok => tok.startsWith(t))) score += 10;
    else if ([...modelTokens, ...otherTokens].some(tok => tok.includes(t))) score += 1;
  }
  return score;
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

  // Each discovered variant gets its own real exact-facet query (in
  // parallel) so its Count and rows come straight from Encar, not a sample.
  const variantResults = await Promise.all(
    [...variantScores.entries()].map(async ([modelValue, score]) => {
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query;

  const page   = Math.max(0, parseInt(q.page  ?? '0'));
  const count  = Math.min(500, Math.max(1, parseInt(q.count ?? '24')));
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

  const sortKey = q.sort === 'priceAsc' ? 'PriceAsc' : q.sort === 'priceDesc' ? 'PriceDesc' : 'ModifiedDate';

  // Filters shared by every attempt (fuel/year/mileage/price/transmission/color)
  const commonParts = [];

  if (q.fuel) {
    const mapped = FUEL_MAP[q.fuel.toLowerCase().trim()] ?? q.fuel;
    commonParts.push(`FuelType.${mapped}`);
  }

  if (q.transmission) {
    const mapped = TRANSMISSION_MAP[q.transmission.toLowerCase().trim()] ?? q.transmission;
    commonParts.push(`Transmission.${mapped}`);
  }

  if (q.color) {
    const mapped = COLOR_MAP[q.color.toLowerCase().trim()] ?? q.color;
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

  // Only a confirmed dictionary hit is trustworthy as an *exact* Model facet —
  // Encar stores everything else (series/class/code-style names) with a
  // generation-code suffix, so an exact filter on those either goes empty or
  // (worse) returns a small, misleadingly "successful" sliver of real matches
  // (e.g. only the one Audi listing literally tagged "A4" with no suffix).
  const identityParts = [];
  if (manufacturer) identityParts.push(`Manufacturer.${manufacturer}`);
  if (model && modelExact) identityParts.push(`Model.${model}`);

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);

  try {
    let data = await runSearch([...identityParts, ...commonParts], offset, count, ctrl.signal, sortKey);

    // A non-exact model was left out of the facet filter above — narrow the
    // (brand-wide) results down by substring-matching it now, rather than
    // waiting for a hard zero-result before trying.
    if (model && !modelExact) {
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
    if (data.SearchResults.length === 0 && (manufacturer || model)) {
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
    const results = sortKey === 'ModifiedDate'
      ? data.SearchResults.map((car, i) => ({ car, i, s: qualityScore(car) }))
          .sort((a, b) => b.s - a.s || a.i - b.i)
          .map(x => x.car)
      : data.SearchResults;

    return res.status(200).json({
      total:   data.Count,
      page,
      count:   results.length,
      results,
    });

  } catch (err) {
    clearTimeout(timer);
    const isTimeout = ctrl.signal.aborted;
    const detail    = err instanceof AggregateError
      ? err.errors.map(e => e.message).join(' | ')
      : err.message;

    return res.status(isTimeout ? 504 : 502).json({
      error:  isTimeout ? 'Koha skadoi. Provo përsëri.' : 'Të gjithë proxy-t dështuan.',
      code:   isTimeout ? 'TIMEOUT' : 'ALL_FAILED',
      detail,
    });
  }
}
