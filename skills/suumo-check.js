/**
 * SUUMO Competitor Check Skill (v2 - Filter-based)
 *
 * Searches SUUMO by station + rent filters to check if competitors
 * are listing the same property. Simulates real user search behavior.
 *
 * Two-step approach:
 * 1. Search by station + rent range → market size (total listings in area)
 * 2. Same conditions + fw2 (building name) → check if exact property appears
 *
 * Station codes are looked up dynamically from SUUMO's ensen pages
 * and cached in memory for subsequent calls.
 *
 * Fallback: if station code lookup fails, uses ward (sc) + rent filters.
 */

// ── Area codes (fallback for ward-based search) ──────────────
const AREA_CODES = {
  千代田区: "13101", 中央区: "13102", 港区: "13103", 新宿区: "13104",
  文京区: "13105", 台東区: "13106", 墨田区: "13107", 江東区: "13108",
  品川区: "13109", 目黒区: "13110", 大田区: "13111", 世田谷区: "13112",
  渋谷区: "13113", 中野区: "13114", 杉並区: "13115", 豊島区: "13116",
  北区: "13117", 荒川区: "13118", 板橋区: "13119", 練馬区: "13120",
  足立区: "13121", 葛飾区: "13122", 江戸川区: "13123",
};

// ── Selectors ────────────────────────────────────────────────
const SUUMO_SELECTORS = {
  resultCard: ".cassetteitem",
  buildingTitle: ".cassetteitem_content-title",
  address: ".cassetteitem_detail-col1",
  detailLink: "a[href*='jnc_']",
  hitCount: ".paginate_set-hit",
  shopName: ".viewform_advance_shop-name",
  shopSection: ".viewform_advance_shop",
};

// ── In-memory station code cache ─────────────────────────────
// Populated dynamically from SUUMO's ensen pages.
// Key: "{normalizedLine}_{normalizedStation}" → stationCode (9-digit)
const stationCache = {};
// Key: "{normalizedLine}" → { lineCode, lineUrl }
const lineCache = {};

// ── Helpers ──────────────────────────────────────────────────

/** Normalize full-width alphanumerics to half-width, trim spaces. */
function normalize(str) {
  if (!str) return "";
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .replace(/　/g, " ")
    .trim();
}

/** Parse hit count text like "1,234件" → 1234 */
function parseHitCount(text) {
  if (!text) return 0;
  const m = text.match(/([\d,]+)件/);
  return m ? parseInt(m[1].replace(/,/g, "")) : 0;
}

// ── Station Code Lookup (dynamic) ────────────────────────────

/**
 * Look up SUUMO station code by navigating ensen pages.
 * Results are cached in memory.
 *
 * @param {Page} page - Playwright page
 * @param {string} lineName - Line name from REINS (e.g., "西武新宿線")
 * @param {string} stationName - Station name from REINS (e.g., "下落合")
 * @returns {{ lineCode: string, stationCode: string } | null}
 */
async function lookupStationCode(page, lineName, stationName) {
  const nLine = normalize(lineName);
  const nStation = normalize(stationName);
  const cacheKey = `${nLine}_${nStation}`;

  // Return from cache if available
  if (stationCache[cacheKey]) {
    return stationCache[cacheKey];
  }

  // Step 1: Get line URL from ensen index (cached per line)
  let lineInfo = lineCache[nLine];
  if (!lineInfo) {
    await page.goto("https://suumo.jp/chintai/tokyo/ensen/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(2000);

    lineInfo = await page.evaluate((target) => {
      // All line links are inside the ensen listing
      const links = document.querySelectorAll("a[href*='/chintai/']");
      for (const link of links) {
        const text = link.textContent.trim();
        // Match: exact or partial (e.g., "JR山手線" matches "JR山手線（東京都）")
        if (text.includes(target) || target.includes(text.replace(/（.*）/, ""))) {
          return { lineUrl: link.href, lineName: text };
        }
      }
      return null;
    }, nLine);

    if (!lineInfo) return null;
    lineCache[nLine] = lineInfo;
  }

  // Step 2: Navigate to the line's station list page
  await page.goto(lineInfo.lineUrl, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await page.waitForTimeout(2000);

  // Step 3: Find station code from checkboxes (name="ek")
  const result = await page.evaluate((target) => {
    const checkboxes = document.querySelectorAll('input[name="ek"]');
    for (const cb of checkboxes) {
      // Station name is in the associated label
      const container = cb.closest("li") || cb.closest("label") || cb.parentElement;
      const text = container?.textContent?.trim() || "";
      if (text.includes(target)) {
        return { stationCode: cb.value };
      }
    }
    return null;
  }, nStation);

  if (!result) return null;

  // Derive line code from station code (first 4 digits)
  const lineCode = result.stationCode.substring(0, 4);
  const cached = { lineCode, stationCode: result.stationCode };
  stationCache[cacheKey] = cached;

  return cached;
}

// ── URL Builder ──────────────────────────────────────────────

/**
 * Build SUUMO search URL.
 * @param {object} params
 * @param {string} [params.stationCode] - 9-digit station code (ek)
 * @param {string} [params.lineCode] - 4-digit line code (rn)
 * @param {string} [params.wardCode] - 5-digit ward code (sc) — fallback
 * @param {number} [params.rentMin] - Min rent in 万円
 * @param {number} [params.rentMax] - Max rent in 万円
 * @param {string} [params.buildingName] - Building name filter (fw2)
 */
function buildSearchUrl({ stationCode, lineCode, wardCode, rentMin, rentMax, buildingName }) {
  const base = "https://suumo.jp/jj/chintai/ichiran/FR301FC001/";
  const p = new URLSearchParams();
  p.set("ar", "030"); // 関東
  p.set("bs", "040"); // 賃貸

  if (stationCode && lineCode) {
    // Station-based search
    p.set("ra", "013");
    p.set("rn", lineCode);
    p.set("ek", stationCode);
  } else if (wardCode) {
    // Ward-based fallback
    p.set("ta", "13");
    p.set("sc", wardCode);
  }

  if (rentMin) p.set("cb", rentMin.toString());
  if (rentMax) p.set("ct", rentMax.toString());
  if (buildingName) p.set("fw2", buildingName);

  return `${base}?${p.toString()}`;
}

// ── Result Parser ────────────────────────────────────────────

/**
 * Parse search results from the current page.
 * @param {Page} page
 * @param {string} targetName - Building name to match against
 */
async function parseResults(page, targetName) {
  return page.evaluate(
    (selectors, target) => {
      const cards = document.querySelectorAll(selectors.resultCard);
      const hitEl = document.querySelector(selectors.hitCount);
      const totalHits =
        hitEl?.textContent?.trim()?.match(/([\d,]+)件/)?.[1]?.replace(/,/g, "") || "0";

      const listings = [];
      let buildingFound = false;

      for (const card of cards) {
        const title =
          card.querySelector(selectors.buildingTitle)?.textContent?.trim() || "";
        const addr =
          card.querySelector(selectors.address)?.textContent?.trim() || "";
        const links = Array.from(card.querySelectorAll(selectors.detailLink));

        const isMatch = title.includes(target) || target.includes(title);
        if (isMatch) buildingFound = true;

        for (const link of links) {
          listings.push({
            buildingName: title,
            address: addr,
            detailUrl: link.href,
            isTargetBuilding: isMatch,
          });
        }
      }

      return {
        totalHits: parseInt(totalHits),
        buildingFound,
        listings,
      };
    },
    SUUMO_SELECTORS,
    targetName
  );
}

// ── Main: Filter-based Competitor Check ──────────────────────

/**
 * Check if competitors are listing a property on SUUMO,
 * by searching the same way a real customer would (station + rent).
 *
 * @param {Page} page - Playwright page
 * @param {object} reinsData - Extracted REINS data
 *   Required fields: 交通 (array), 賃料 (string), 建物名 (string)
 *   Optional: 都道府県名, 所在地名１ (for ward fallback)
 * @param {object} [options]
 * @param {number} [options.rentBuffer=2] - ±万円 buffer for rent range
 * @returns {object} result
 */
async function checkByFilters(page, reinsData, options = {}) {
  const { rentBuffer = 2 } = options;

  // ─── Parse rent ───
  const rentMatch = reinsData.賃料?.match(/([\d.]+)/);
  if (!rentMatch) {
    return { error: "賃料を解析できません", reinsRent: reinsData.賃料 };
  }
  const rent = parseFloat(rentMatch[1]);
  const rentMin = Math.max(1, Math.floor((rent - rentBuffer) * 10) / 10);
  const rentMax = Math.ceil((rent + rentBuffer) * 10) / 10;

  // ─── Parse transport ───
  const transport = reinsData.交通?.[0];
  if (!transport?.沿線 || !transport?.駅) {
    return { error: "交通情報（沿線・駅）がありません" };
  }

  const lineName = normalize(transport.沿線);
  const stationName = normalize(transport.駅);
  const buildingName = normalize(reinsData.建物名);

  // ─── Look up station code ───
  let searchMode = "station";
  let stationCode, lineCode, wardCode;

  const stationInfo = await lookupStationCode(page, lineName, stationName);
  if (stationInfo) {
    stationCode = stationInfo.stationCode;
    lineCode = stationInfo.lineCode;
  } else {
    // Fallback: ward-based search
    searchMode = "ward";
    const ward = reinsData.所在地名１;
    const wardKey = ward
      ? Object.keys(AREA_CODES).find((k) => ward.includes(k) || k.includes(ward))
      : null;
    if (!wardKey) {
      return {
        error: `駅コード取得失敗 (${lineName} ${stationName})、区コードも特定不可`,
      };
    }
    wardCode = AREA_CODES[wardKey];
  }

  // ─── Step 1: Market overview (station/ward + rent, NO building name) ───
  const marketUrl = buildSearchUrl({
    stationCode,
    lineCode,
    wardCode,
    rentMin,
    rentMax,
  });
  await page.goto(marketUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  const marketResult = await parseResults(page, buildingName);

  // ─── Step 2: Exact check (+ building name filter) ───
  const exactUrl = buildSearchUrl({
    stationCode,
    lineCode,
    wardCode,
    rentMin,
    rentMax,
    buildingName,
  });
  await page.goto(exactUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  const exactResult = await parseResults(page, buildingName);
  const competitorListings = exactResult.listings.filter((l) => l.isTargetBuilding);

  return {
    searchMode,
    searchConditions: {
      line: lineName,
      station: stationName,
      rentRange: `${rentMin}〜${rentMax}万円`,
      actualRent: `${rent}万円`,
    },
    // Market context
    marketSize: marketResult.totalHits,
    // Competitor result
    found: exactResult.totalHits > 0,
    competitorCount: competitorListings.length,
    totalListingsForBuilding: exactResult.totalHits,
    competitorListings,
    // URLs
    searchUrls: { market: marketUrl, exact: exactUrl },
  };
}

// ── Detail: Get listing company name ─────────────────────────

/**
 * Get the company name from a SUUMO detail page.
 */
async function getListingCompany(page, detailUrl) {
  await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(2000);

  return page.evaluate((selector) => {
    return document.querySelector(selector)?.textContent?.trim() || null;
  }, SUUMO_SELECTORS.shopName);
}

module.exports = {
  AREA_CODES,
  SUUMO_SELECTORS,
  stationCache,
  lineCache,
  normalize,
  lookupStationCode,
  buildSearchUrl,
  parseResults,
  checkByFilters,
  getListingCompany,
};
