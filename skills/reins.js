/**
 * REINS Skill - Login, Search, Data Extraction, Image Download
 *
 * Selectors & structure based on investigation (2026-02-12):
 * - Bootstrap-Vue SPA (Nuxt.js)
 * - Dynamic IDs (__BVID__*) → use class-based selectors
 * - Image popup: modal-xl centered, fixed rect (226,70,828,760) at 1280x900
 */

const REINS_URLS = {
  login: "https://system.reins.jp/login/main/KG/GKG001200",
  dashboard: "https://system.reins.jp/main/KG/GKG003100",
  numberSearch: "https://system.reins.jp/main/BK/GBK004100",
  searchResult: "https://system.reins.jp/main/BK/GBK004200",
  detail: "https://system.reins.jp/main/BK/GBK003200",
};

const REINS_SELECTORS = {
  login: {
    idInput: 'input.p-textbox-input[type="text"]',
    passInput: 'input.p-textbox-input[type="password"]',
    checkbox: 'input.custom-control-input[type="checkbox"]',
    submitBtn: "button.p-button",
  },
  dashboard: {
    numberSearchBtn: 'button:has-text("物件番号検索")',
  },
  numberSearch: {
    inputs: 'input.p-textbox-input[type="text"]',
    searchBtn: 'button:has-text("検索")',
  },
  result: {
    row: ".p-table-body-row",
    detailBtn: 'button:has-text("詳細")',
    zumenBtn: 'button:has-text("図面")',
  },
  detail: {
    imageSectionBtn: 'button:has-text("画像・図面")',
    zumenRefBtn: 'button:has-text("図面参照")',
    imageCard: ".col-image",
    labelTitle: ".p-label-title",
  },
  imagePopup: {
    modal: ".modal.show .modal-content",
    imageView: ".flex-fill.image-view",
    closeBtn: 'button:has-text("閉じる")',
    // Fixed coordinates at viewport 1280x900
    clip: { x: 227, y: 131, width: 826, height: 654 },
  },
};

// ── Login ──────────────────────────────────────────────────
async function login(page, credentials) {
  await page.goto(REINS_URLS.login, {
    waitUntil: "networkidle",
    timeout: 20000,
  });
  await page.waitForTimeout(2000);

  await page.fill(REINS_SELECTORS.login.idInput, credentials.id);
  await page.waitForTimeout(300);
  await page.fill(REINS_SELECTORS.login.passInput, credentials.pass);
  await page.waitForTimeout(300);

  // Accept both checkboxes
  const cbs = await page.$$(REINS_SELECTORS.login.checkbox);
  for (const cb of cbs) {
    if (!(await cb.isChecked())) {
      await cb.click({ force: true });
      await page.waitForTimeout(200);
    }
  }
  await page.waitForTimeout(500);
  await page.click(REINS_SELECTORS.login.submitBtn);
  await page.waitForTimeout(5000);

  return page.url().includes("GKG003100");
}

// ── Search by Property Number ──────────────────────────────
async function searchByNumber(page, reinsId) {
  await page.click(REINS_SELECTORS.dashboard.numberSearchBtn);
  await page.waitForTimeout(3000);

  const inputs = await page.$$(REINS_SELECTORS.numberSearch.inputs);
  if (inputs.length === 0) throw new Error("Property number input not found");

  await inputs[0].fill(reinsId);
  await page.waitForTimeout(500);
  await page.click(REINS_SELECTORS.numberSearch.searchBtn);
  await page.waitForTimeout(5000);

  // Check if results found
  const hasResults = await page.evaluate(() => {
    return !document.body.innerText.includes("検索結果が0件");
  });

  return hasResults;
}

// ── Extract All Property Data ──────────────────────────────
async function extractPropertyData(page) {
  // Click detail button
  await page.click(REINS_SELECTORS.result.detailBtn);
  await page.waitForTimeout(5000);

  const data = await page.evaluate(() => {
    const result = {};
    const body = document.body.innerText;

    // Parse using the innerText structure (more reliable than DOM label pairing)
    const patterns = {
      物件番号: /物件番号\s*\n\s*(\S+)/,
      物件種目: /物件種目\s*\n\s*(\S+)/,
      広告転載区分: /広告転載区分\s*\n\s*(\S+)/,
      商号: /商号\s*\n\s*([^\n]+)/,
      代表電話番号: /代表電話番号\s*\n\s*([\d-]+)/,
      賃料: /賃料\s*\n\s*([\d.]+万円)/,
      敷金: /敷金\s*\n\s*([^\n]+)/,
      礼金: /礼金\s*\n\s*([^\n]+)/,
      契約期間: /契約期間\s*\n\s*([^\n]+)/,
      使用部分面積: /使用部分面積\s*\n\s*([\d.]+㎡)/,
      都道府県名: /都道府県名\s*\n\s*(\S+)/,
      所在地名１: /所在地名１\s*\n\s*(\S+)/,
      所在地名２: /所在地名２\s*\n\s*(\S+)/,
      所在地名３: /所在地名３\s*\n\s*(\S+)/,
      建物名: /建物名\s*\n\s*([^\n]+)/,
      部屋番号: /部屋番号\s*\n\s*(\S+)/,
      間取タイプ: /間取タイプ\s*\n\s*(\S+)/,
      間取部屋数: /間取部屋数\s*\n\s*(\S+)/,
      間取その他: /その他\s*\n\s*([\S]+[\s\S]*?)(?=\n建物)/,
      築年月: /築年月\s*\n\s*([^\n]+)/,
      建物構造: /建物構造\s*\n\s*(\S+)/,
      地上階層: /地上階層\s*\n\s*(\S+)/,
      地下階層: /地下階層\s*\n\s*(\S+)/,
      所在階: /所在階\s*\n\s*(\S+)/,
      バルコニー方向: /バルコニー方向\s*\n\s*(\S+)/,
      管理費: /管理費\s*\n\s*([^\n]+)/,
      共益費: /共益費\s*\n\s*([^\n]+)/,
      更新料: /更新料\s*\n\s*([^\n]+)/,
      駐車場在否: /駐車場在否\s*\n\s*(\S+)/,
      現況: /現況\s*\n\s*(\S+)/,
      入居時期: /入居時期\s*\n\s*(\S+)/,
      取引態様: /取引態様\s*\n\s*(\S+)/,
      配分割合客付: /配分割合客付\s*\n\s*([\d.]+)/,
      設備: /設備・条件・住宅性能等\s*\n\s*([^\n]+)/,
      設備フリー: /設備\(フリースペース\)\s*\n\s*([^\n]+)/,
      条件フリー: /条件\(フリースペース\)\s*\n\s*([^\n]+)/,
      備考3: /備考３\s*\n\s*([^\n]+)/,
    };

    for (const [key, regex] of Object.entries(patterns)) {
      const match = body.match(regex);
      if (match) result[key] = match[1].trim();
    }

    // Extract transportation (up to 3 lines)
    const transportPatterns = [
      {
        prefix: "交通１",
        lineRegex: /交通１\s*\n沿線名\s*\n\s*(\S+)\s*\n駅名\s*\n\s*(\S+)\s*\n駅より徒歩\s*\n\s*(\S+)/,
      },
      {
        prefix: "交通２",
        lineRegex: /交通２\s*\n沿線名\s*\n\s*(\S+)\s*\n駅名\s*\n\s*(\S+)\s*\n駅より徒歩\s*\n\s*(\S+)/,
      },
      {
        prefix: "交通３",
        lineRegex: /交通３\s*\n沿線名\s*\n\s*(\S+)\s*\n駅名\s*\n\s*(\S+)\s*\n駅より徒歩\s*\n\s*(\S+)/,
      },
    ];
    result.交通 = [];
    for (const tp of transportPatterns) {
      const m = body.match(tp.lineRegex);
      if (m) {
        result.交通.push({
          沿線: m[1],
          駅: m[2],
          徒歩: m[3],
        });
      }
    }

    return result;
  });

  return data;
}

// ── Extract Image Metadata ─────────────────────────────────
async function extractImageData(page) {
  await page.click(REINS_SELECTORS.detail.imageSectionBtn);
  await page.waitForTimeout(2000);

  const images = await page.evaluate(() => {
    const cards = document.querySelectorAll(".col-image");
    return Array.from(cards).map((card, idx) => {
      const bgDiv = card.querySelector("[style*='background']");
      const style = bgDiv?.getAttribute("style") || "";
      const urlMatch = style.match(/url\("([^"]+)"\)/);
      return {
        index: idx + 1,
        thumbnailUrl: urlMatch?.[1] || "",
      };
    });
  });

  // Derive full-size image URLs from thumbnail URLs
  // Thumbnail: findBkknGzuThm → Full: findBkknGzu
  return images.map((img) => ({
    ...img,
    fullUrl: img.thumbnailUrl.replace("findBkknGzuThm", "findBkknGzu"),
  }));
}

// ── Screenshot All Images (white frame clip) ───────────────
async function screenshotAllImages(page, imageCount, downloadDir) {
  const fs = require("fs");
  const path = require("path");

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const downloaded = [];
  const cards = await page.$$(REINS_SELECTORS.detail.imageCard);
  const count = Math.min(imageCount, cards.length);

  for (let i = 0; i < count; i++) {
    try {
      // Click image card to open modal popup
      const link = await cards[i].$("a");
      if (!link) continue;
      await link.click();
      await page.waitForTimeout(2000);

      // Screenshot the white rectangular frame area
      const filePath = path.join(downloadDir, `reins_${i + 1}.jpg`);
      await page.screenshot({
        type: "jpeg",
        quality: 90,
        clip: REINS_SELECTORS.imagePopup.clip,
        path: filePath,
      });

      downloaded.push({ index: i + 1, localPath: filePath });

      // Close modal
      const closeBtn = await page.$('.modal.show button:has-text("閉じる")');
      if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(800);
      }
    } catch (err) {
      console.error(`Failed to screenshot image ${i + 1}:`, err.message);
      // Try to close modal if still open
      try {
        const closeBtn = await page.$('.modal.show button:has-text("閉じる")');
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(500);
      } catch {}
    }
  }

  return downloaded;
}

// ── Screenshot Image Popup (fixed coordinates) ─────────────
async function screenshotImagePopup(page, imageIndex) {
  const cards = await page.$$(REINS_SELECTORS.detail.imageCard);
  if (imageIndex > cards.length) return null;

  // Click the image card link
  const link = await cards[imageIndex - 1].$("a");
  if (link) await link.click();
  await page.waitForTimeout(2000);

  // Take clip screenshot of the image area
  const buffer = await page.screenshot({
    type: "jpeg",
    quality: 85,
    clip: REINS_SELECTORS.imagePopup.clip,
  });

  // Close modal
  const closeBtn = await page.$('.modal.show button:has-text("閉じる")');
  if (closeBtn) await closeBtn.click();
  await page.waitForTimeout(500);

  return buffer;
}

module.exports = {
  REINS_URLS,
  REINS_SELECTORS,
  login,
  searchByNumber,
  extractPropertyData,
  extractImageData,
  screenshotAllImages,
};
