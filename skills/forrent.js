/**
 * forrent.jp (SUUMO入稿・分析システム) Skill
 *
 * Login, navigate to 新規物件登録, fill all form fields from REINS data.
 *
 * Key findings:
 * - Frameset layout: navi + main
 * - Struts form with ${bukkenInputForm.xxx} naming
 * - 1,021 input elements across 9 sections
 * - Select cascades (都道府県→市区町村→町→字)
 * - Image upload via file input
 * - Submit button: input[type="image"]#Image7 (login)
 * - Menu buttons: CSS background-image buttons (#menu_1 ~ #menu_9)
 */

const FORRENT_URLS = {
  login: "https://www.fn.forrent.jp/fn/",
  loginAction: "https://www.fn.forrent.jp/fn/login.action",
};

const FORRENT_SELECTORS = {
  login: {
    idInput: 'input[type="text"]',
    passInput: 'input[type="password"]',
    submitBtn: 'input[type="image"]',
  },
  navi: {
    frame: 'frame[name="navi"]',
    menuTop: "#menu_1",
    menuNewProperty: "#menu_2",
    menuPlacement: "#menu_3",
    menuBulk: "#menu_4",
    menuAnalysis: "#menu_6",
    menuManage: "#menu_7",
  },
  // Form field IDs in the main frame (REG1R1100AF2.action)
  form: {
    // 棟情報
    bukkenNm: "#bukkenNm", // 物件名
    kai: "#kai", // 地上階建
    chikaInput: "#chikaInput", // 地下階建
    kaibubun: "#kaibubun", // 階部分
    heyaNoInput: "#heyaNoInput", // 号室
    bukkenShuCd: 'select[name="${bukkenInputForm.bukkenShuCd}"]', // 物件種別
    kozoShuCd: 'select[name="${bukkenInputForm.kozoShuCd}"]', // 構造
    chikuNen: "#Wareki2Seireki1", // 築年(西暦)
    chikuGetsu: 'input[name="${bukkenInputForm.chikuGetsu}"]', // 築月
    shinchikuKbn: {
      chuko: "#shinchikuKbnCd1",
      shinchiku: "#shinchikuKbnCd2",
      minyukyo: "#shinchikuKbnCd3",
    },
    // 所在地
    todofukenList: "#todofukenList",
    shigunkuList: "#shigunkuList",
    chosonList: "#chosonList",
    azaList: "#azaList",
    ikaJusho: 'input[name="${bukkenInputForm.ikaJusho}"]', // 以下住所
    // 交通 (3 lines)
    // 沿線・駅は select で連動するため、直接入力できない場合がある
    // お金
    chinryo: 'input[name="${bukkenInputForm.chinryou}"]', // 月額賃料
    kanrihi: 'input[name="${bukkenInputForm.kanrihi}"]', // 管理費
    reikin: 'input[name="${bukkenInputForm.reikin}"]', // 礼金
    shikikin: 'input[name="${bukkenInputForm.shikikin}"]', // 敷金
    // 間取り
    madoriCd: 'select[name="${bukkenInputForm.madoriCd}"]', // 間取りタイプ
    menseki: 'input[name="${bukkenInputForm.senyuMenseki}"]', // 専有面積
    // Submit
    confirmBtn: "#confirmButton", // 確認画面へ
  },
};

// ── Mapping: 構造コード ──
const STRUCTURE_MAP = {
  ＲＣ: "鉄筋コン",
  RC: "鉄筋コン",
  鉄筋コンクリート: "鉄筋コン",
  ＳＲＣ: "鉄骨鉄筋",
  SRC: "鉄骨鉄筋",
  鉄骨鉄筋コンクリート: "鉄骨鉄筋",
  Ｓ: "鉄骨",
  S: "鉄骨",
  鉄骨: "鉄骨",
  軽量鉄骨: "軽量鉄骨",
  木造: "木造",
};

// ── Mapping: 物件種別コード ──
const PROPERTY_TYPE_MAP = {
  マンション: "マンション",
  アパート: "アパート",
  一戸建て: "一戸建て",
  テラスハウス: "テラス・タウンハウス",
};

// ── Mapping: 間取りコード ──
const LAYOUT_MAP = {
  ワンルーム: "1R",
  "1R": "1R",
  "1K": "1K",
  "1DK": "1DK",
  "1LDK": "1LDK",
  ＬＤＫ: "1LDK", // REINS uses full-width
  "2K": "2K",
  "2DK": "2DK",
  "2LDK": "2LDK",
  "3K": "3K",
  "3DK": "3DK",
  "3LDK": "3LDK",
  "4K": "4K",
  "4DK": "4DK",
  "4LDK": "4LDK",
};

// ── Login ──────────────────────────────────────────────────
async function login(page, credentials) {
  await page.goto(FORRENT_URLS.login, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.waitForTimeout(3000);

  await page.fill(FORRENT_SELECTORS.login.idInput, credentials.id);
  await page.waitForTimeout(300);
  await page.fill(FORRENT_SELECTORS.login.passInput, credentials.pass);
  await page.waitForTimeout(300);
  await page.click(FORRENT_SELECTORS.login.submitBtn);
  await page.waitForTimeout(8000);

  return page.url().includes("main_r.action");
}

// ── Navigate to New Property Registration ──────────────────
async function navigateToNewProperty(page) {
  const naviFrame = page.frame({ name: "navi" });
  if (!naviFrame) throw new Error("Navi frame not found");

  await naviFrame.click(FORRENT_SELECTORS.navi.menuNewProperty);
  await page.waitForTimeout(5000);

  const mainFrame = page.frame({ name: "main" });
  if (!mainFrame) throw new Error("Main frame not found");

  // Verify we're on the registration form
  const title = await mainFrame.title();
  return { mainFrame, title };
}

// ── Fill Form from REINS Data ──────────────────────────────
async function fillPropertyForm(mainFrame, reinsData) {
  const filled = {};
  const errors = [];

  // Helper: safe fill
  async function safeFill(selector, value, fieldName) {
    if (!value) return;
    try {
      await mainFrame.fill(selector, value);
      filled[fieldName] = value;
      await mainFrame.waitForTimeout(200);
    } catch (e) {
      errors.push(`${fieldName}: ${e.message.slice(0, 60)}`);
    }
  }

  // Helper: safe select by visible text
  async function safeSelect(selector, text, fieldName) {
    if (!text) return;
    try {
      await mainFrame.selectOption(selector, { label: text });
      filled[fieldName] = text;
      await mainFrame.waitForTimeout(500); // cascade selects need time
    } catch (e) {
      // Try partial match
      try {
        const options = await mainFrame.evaluate(
          (sel, txt) => {
            const select = document.querySelector(sel);
            if (!select) return [];
            return Array.from(select.options).map((o) => ({
              value: o.value,
              text: o.text,
            }));
          },
          selector,
          text
        );
        const match = options.find(
          (o) => o.text.includes(text) || text.includes(o.text)
        );
        if (match) {
          await mainFrame.selectOption(selector, match.value);
          filled[fieldName] = match.text;
          await mainFrame.waitForTimeout(500);
        } else {
          errors.push(`${fieldName}: No match for "${text}" in options`);
        }
      } catch (e2) {
        errors.push(`${fieldName}: ${e2.message.slice(0, 60)}`);
      }
    }
  }

  // Helper: safe radio click
  async function safeRadio(selector, fieldName) {
    try {
      await mainFrame.click(selector);
      filled[fieldName] = true;
      await mainFrame.waitForTimeout(200);
    } catch (e) {
      errors.push(`${fieldName}: ${e.message.slice(0, 60)}`);
    }
  }

  // ═══ Section 1: 棟情報 ═══
  await safeFill("#bukkenNm", reinsData.建物名, "物件名");

  // 階建
  const floors = reinsData.地上階層?.match(/(\d+)/)?.[1];
  if (floors) await safeFill("#kai", floors, "地上階建");

  const bFloors = reinsData.地下階層?.match(/(\d+)/)?.[1];
  if (bFloors) await safeFill("#chikaInput", bFloors, "地下階建");

  // 階部分
  const floor = reinsData.所在階?.match(/(\d+)/)?.[1];
  if (floor) await safeFill("#kaibubun", floor, "階部分");

  // 号室
  await safeFill("#heyaNoInput", reinsData.部屋番号, "号室");

  // 物件種別
  const propType = PROPERTY_TYPE_MAP[reinsData.物件種目] || reinsData.物件種目;
  await safeSelect(
    FORRENT_SELECTORS.form.bukkenShuCd,
    propType,
    "物件種別"
  );

  // 構造
  const structure =
    STRUCTURE_MAP[reinsData.建物構造] || reinsData.建物構造;
  await safeSelect(FORRENT_SELECTORS.form.kozoShuCd, structure, "構造");

  // 築年月
  const yearMatch = reinsData.築年月?.match(/(\d{4})年/);
  const monthMatch = reinsData.築年月?.match(/(\d{1,2})月/);
  if (yearMatch) {
    await safeFill("#Wareki2Seireki1", yearMatch[1], "築年");
  }
  if (monthMatch) {
    await safeFill(
      FORRENT_SELECTORS.form.chikuGetsu,
      monthMatch[1],
      "築月"
    );
  }
  // 中古 radio
  await safeRadio("#shinchikuKbnCd1", "中古フラグ");

  // 所在地 (cascade selects)
  // 都道府県
  await safeSelect("#todofukenList", reinsData.都道府県名, "都道府県");
  await mainFrame.waitForTimeout(1000); // Wait for cascade

  // 市区町村
  await safeSelect("#shigunkuList", reinsData.所在地名１, "市区町村");
  await mainFrame.waitForTimeout(1000);

  // 町村 - 所在地名2 (e.g., "上落合２丁目")
  if (reinsData.所在地名２) {
    // Extract the town name part for select match
    const townName = reinsData.所在地名２.replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    );
    await safeSelect("#chosonList", townName, "町村");
    await mainFrame.waitForTimeout(1000);
  }

  // 以下住所
  if (reinsData.所在地名３) {
    await safeFill(
      FORRENT_SELECTORS.form.ikaJusho,
      reinsData.所在地名３,
      "以下住所"
    );
  }

  // ═══ Section 2: お金・駐車場等 ═══
  // 賃料 (e.g., "10.5万円" → "10.5")
  const rentMatch = reinsData.賃料?.match(/([\d.]+)万円/);
  if (rentMatch) {
    await safeFill(
      FORRENT_SELECTORS.form.chinryo,
      rentMatch[1],
      "月額賃料"
    );
  }

  // 管理費/共益費 (e.g., "4,000円" → "0.4")
  const mgmtMatch = reinsData.共益費?.match(/([\d,]+)円/);
  if (mgmtMatch) {
    const mgmtYen = parseInt(mgmtMatch[1].replace(/,/g, ""));
    const mgmtMan = (mgmtYen / 10000).toFixed(1);
    // management fee checkbox + input
    try {
      const mgmtCheckbox = await mainFrame.$(
        'input[id*="kanrihiAriFlg"], input[name*="kanrihiAriFlg"]'
      );
      if (mgmtCheckbox && !(await mgmtCheckbox.isChecked())) {
        await mgmtCheckbox.click();
        await mainFrame.waitForTimeout(300);
      }
      await safeFill(FORRENT_SELECTORS.form.kanrihi, mgmtMan, "管理費");
    } catch (e) {
      errors.push(`管理費: ${e.message.slice(0, 60)}`);
    }
  }

  // 敷金
  const shikiMatch = reinsData.敷金?.match(/([\d.]+)/);
  if (shikiMatch) {
    try {
      const shikiCheckbox = await mainFrame.$(
        'input[id*="shikikinAriFlg"], input[name*="shikikinAriFlg"]'
      );
      if (shikiCheckbox && !(await shikiCheckbox.isChecked())) {
        await shikiCheckbox.click();
        await mainFrame.waitForTimeout(300);
      }
      await safeFill(FORRENT_SELECTORS.form.shikikin, shikiMatch[1], "敷金");
    } catch (e) {
      errors.push(`敷金: ${e.message.slice(0, 60)}`);
    }
  }

  // 礼金
  const reiMatch = reinsData.礼金?.match(/([\d.]+)/);
  if (reiMatch) {
    try {
      const reiCheckbox = await mainFrame.$(
        'input[id*="reikinAriFlg"], input[name*="reikinAriFlg"]'
      );
      if (reiCheckbox && !(await reiCheckbox.isChecked())) {
        await reiCheckbox.click();
        await mainFrame.waitForTimeout(300);
      }
      await safeFill(FORRENT_SELECTORS.form.reikin, reiMatch[1], "礼金");
    } catch (e) {
      errors.push(`礼金: ${e.message.slice(0, 60)}`);
    }
  }

  // ═══ Section 4: 間取り ═══
  // 間取りタイプ
  if (reinsData.間取タイプ && reinsData.間取部屋数) {
    const rooms = reinsData.間取部屋数?.match(/(\d+)/)?.[1] || "1";
    const type = reinsData.間取タイプ
      .replace(/[Ａ-Ｚ]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) - 0xfee0)
      );
    const layoutKey = `${rooms}${type}`;
    const layoutLabel = LAYOUT_MAP[layoutKey] || layoutKey;
    await safeSelect(FORRENT_SELECTORS.form.madoriCd, layoutLabel, "間取り");
  }

  // 面積
  const areaMatch = reinsData.使用部分面積?.match(/([\d.]+)/);
  if (areaMatch) {
    await safeFill(FORRENT_SELECTORS.form.menseki, areaMatch[1], "面積");
  }

  return { filled, errors };
}

// ── Upload Images ──────────────────────────────────────────
async function uploadImages(mainFrame, imagePaths) {
  const uploaded = [];

  // Navigate to image section (section 9)
  try {
    await mainFrame.click('a:has-text("画像・動画・CM・パノラマ")');
    await mainFrame.waitForTimeout(2000);
  } catch (_) {
    // Section might already be visible
  }

  // Find file input elements for images
  const fileInputs = await mainFrame.$$(
    'input[type="file"][name*="gazou"], input[type="file"][name*="image"], input[type="file"][id*="gazou"]'
  );

  for (let i = 0; i < Math.min(imagePaths.length, fileInputs.length); i++) {
    try {
      await fileInputs[i].setInputFiles(imagePaths[i]);
      uploaded.push(imagePaths[i]);
      await mainFrame.waitForTimeout(1000);
    } catch (e) {
      console.error(`Image upload ${i} failed:`, e.message);
    }
  }

  return uploaded;
}

module.exports = {
  FORRENT_URLS,
  FORRENT_SELECTORS,
  STRUCTURE_MAP,
  PROPERTY_TYPE_MAP,
  LAYOUT_MAP,
  login,
  navigateToNewProperty,
  fillPropertyForm,
  uploadImages,
};
