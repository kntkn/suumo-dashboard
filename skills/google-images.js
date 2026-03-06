/**
 * Google Image Search — Playwright-based image acquisition
 *
 * 1. Missing 5pt category images: search "[property name] キッチン" etc.
 * 2. Surrounding environment photos: Google Maps nearby search → Google Image search
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

/**
 * Google Image search via Playwright — download first usable result
 *
 * @param {import('playwright').BrowserContext} context
 * @param {string} query - search query
 * @param {string} outputPath - file save path
 * @returns {string|null} saved file path or null
 */
async function googleImageSearch(context, query, outputPath) {
  const page = await context.newPage();
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&udm=2`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Extract image URLs from search results
    const imageUrls = await page.evaluate(() => {
      const urls = [];
      // Google Images stores full-size URLs in data attributes or in <img> src
      const imgs = document.querySelectorAll("img");
      for (const img of imgs) {
        const src = img.src || "";
        // Skip Google UI images, base64 placeholders, and tiny icons
        if (src.startsWith("data:") || src.includes("google.com/images") ||
            src.includes("gstatic.com") || src.includes("googleusercontent.com/favicon") ||
            !src.startsWith("http")) continue;
        if (img.naturalWidth > 100 && img.naturalHeight > 100) {
          urls.push(src);
        }
      }
      // Also check for encrypted_tbn URLs (Google's image proxies)
      const encImgs = document.querySelectorAll('img[src*="encrypted-tbn"]');
      for (const img of encImgs) {
        if (img.naturalWidth > 50) urls.push(img.src);
      }
      return [...new Set(urls)].slice(0, 5);
    });

    if (imageUrls.length === 0) {
      console.log(`[google-img] No images found for: ${query}`);
      return null;
    }

    // Try to click first result to get full-size image
    let fullUrl = null;
    try {
      // Click first image thumbnail to open preview
      const firstImg = await page.$('div[data-ri="0"] img, div[jscontroller] img');
      if (firstImg) {
        await firstImg.click();
        await page.waitForTimeout(2000);
        // Get the full-size image from the preview panel
        fullUrl = await page.evaluate(() => {
          // The preview panel shows larger images
          const previewImgs = document.querySelectorAll('img[jsname="kn3ccd"], img[jsname="HiaYvf"]');
          for (const img of previewImgs) {
            const src = img.src || "";
            if (src.startsWith("http") && !src.includes("encrypted-tbn") && img.naturalWidth > 200) {
              return src;
            }
          }
          return null;
        });
      }
    } catch { /* preview click failed, use thumbnail */ }

    const targetUrl = fullUrl || imageUrls[0];
    console.log(`[google-img] Downloading: ${targetUrl.slice(0, 80)}...`);

    // Download via Playwright's fetch (handles cookies/redirects)
    const response = await page.context().request.get(targetUrl, { timeout: 10000 });
    if (response.ok()) {
      const buffer = await response.body();
      // Resize to standard format
      await sharp(buffer)
        .resize({ width: 1280, height: 960, fit: "cover", position: "centre" })
        .jpeg({ quality: 85 })
        .toFile(outputPath);
      console.log(`[google-img] Saved: ${path.basename(outputPath)}`);
      return outputPath;
    }

    return null;
  } catch (e) {
    console.log(`[google-img] Error for "${query}": ${e.message.slice(0, 80)}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Fetch surrounding environment photos using Google Maps + Image search
 *
 * Flow:
 * 1. Google Maps search for facilities near the property
 * 2. Google Image search for each facility name
 * 3. Download and resize 6 photos
 *
 * @param {import('playwright').BrowserContext} context
 * @param {object} reinsData - REINS property data
 * @param {string} downloadDir - output directory
 * @returns {Array<{localPath: string, categoryLabel: string, facilityName: string, facilityType: string}>}
 */
async function fetchShuhenPhotos(context, reinsData, downloadDir) {
  const outDir = path.join(downloadDir, "shuhen");
  fs.mkdirSync(outDir, { recursive: true });

  const address = `${reinsData.都道府県名 || ""}${reinsData.所在地名１ || ""}${reinsData.所在地名２ || ""}${reinsData.所在地名３ || ""}`;
  if (!address) {
    console.log("[google-img] No address for shuhen search");
    return [];
  }

  // Required facility types with Google Maps search terms
  const facilityTypes = [
    { type: "コンビニ", query: "コンビニ" },
    { type: "スーパー", query: "スーパーマーケット" },
    { type: "ドラッグストア", query: "ドラッグストア 薬局" },
    { type: "郵便局", query: "郵便局" },
    { type: "病院", query: "病院 クリニック" },
    { type: "学校", query: "小学校" },
  ];

  // Step 1: Search Google Maps for nearby facilities
  const page = await context.newPage();
  const facilities = [];

  try {
    for (const ft of facilityTypes) {
      if (facilities.length >= 6) break;

      const mapQuery = `${address} ${ft.query}`;
      const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}`;

      try {
        await page.goto(mapUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(3000);

        // Extract first facility name from results
        const facilityName = await page.evaluate(() => {
          // Google Maps results show facility names in various elements
          const candidates = [
            ...document.querySelectorAll('[role="feed"] a[aria-label]'),
            ...document.querySelectorAll('.fontHeadlineSmall'),
            ...document.querySelectorAll('h3.fontHeadlineSmall'),
          ];
          for (const el of candidates) {
            const name = (el.ariaLabel || el.textContent || "").trim();
            if (name && name.length > 1 && name.length < 50) return name;
          }
          return null;
        });

        if (facilityName) {
          facilities.push({ name: facilityName, type: ft.type });
          console.log(`[google-img] Maps: ${ft.type} → ${facilityName}`);
        } else {
          // Fallback: use generic facility name
          facilities.push({ name: `${address}付近の${ft.type}`, type: ft.type });
          console.log(`[google-img] Maps: ${ft.type} → generic fallback`);
        }
      } catch (e) {
        facilities.push({ name: `${address}付近の${ft.type}`, type: ft.type });
        console.log(`[google-img] Maps error for ${ft.type}: ${e.message.slice(0, 50)}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  // Step 2: Google Image search for each facility
  const results = [];
  for (let i = 0; i < facilities.length && i < 6; i++) {
    const facility = facilities[i];
    const outputPath = path.join(outDir, `shuhen_${i + 1}_${facility.type}.jpg`);
    const query = `${facility.name} 外観`;

    const saved = await googleImageSearch(context, query, outputPath);
    if (saved) {
      results.push({
        localPath: saved,
        categoryLabel: "周辺環境",
        facilityName: facility.name,
        facilityType: facility.type,
      });
    }
  }

  console.log(`[google-img] Shuhen photos: ${results.length}/${facilities.length} acquired`);
  return results;
}

module.exports = { fetchShuhenPhotos, googleImageSearch };
