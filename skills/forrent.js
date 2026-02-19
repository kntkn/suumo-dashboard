/**
 * forrent.jp (SUUMO入稿) Skill — v3
 *
 * form-structure.json (891 fields) から取得した実データに基づく
 * 完全に決定論的なフィールドマッピング。推測ベースのセレクタは廃止。
 *
 * フォーム構造（入力順序）:
 * 1. 棟情報: 物件名, 階建, 部屋番号, 物件種別, 構造, 築年月
 * 2. 所在地: 都道府県→市郡区→町村(cascade)→字丁(cascade)→番地
 * 3. 会社間流通チェックボックス OFF
 * 4. 交通: らくらく交通入力 (id=rakurakuKotsu)
 * 5. お金: 賃料(万+千), 管理費(万+円), 敷金(ヶ月/万), 礼金(ヶ月/万)
 * 6. 間取り: 部屋数 + タイプ(select) + 面積(整数+小数)
 * 7. テキスト: bukkenCatch, netCatch, netFreeMemo, freeMemo
 * 8. 画像: 外観(gaikan), パース(perth), 室内(shitsunai), 写真1-3, 追加画像1-8
 */

// ── URLs & Selectors ──

const FORRENT_URLS = {
  login: "https://www.fn.forrent.jp/fn/",
};

const FORRENT_SELECTORS = {
  login: {
    idInput: 'input[type="text"]',
    passInput: 'input[type="password"]',
    submitBtn: 'input[type="image"]',
  },
  navi: {
    menuNewProperty: "#menu_2",
  },
};

// ── REINS → forrent.jp 値マッピング ──

// Struts form name prefix (HTML上のリテラル文字列)
const S = "${bukkenInputForm.";

// 物件種別 code
const PROPERTY_TYPE_CODE = {
  マンション: "01", アパート: "02", "一戸建て": "11", "一戸建": "11",
  "テラス・タウンハウス": "16", テラスハウス: "16", タウンハウス: "16", その他: "99",
};

// 構造 code
const STRUCTURE_CODE = {
  RC: "01", ＲＣ: "01", 鉄筋コンクリート: "01", "鉄筋コン": "01",
  SRC: "02", ＳＲＣ: "02", 鉄骨鉄筋コンクリート: "02", "鉄骨鉄筋": "02",
  PC: "03", "プレコン": "03",
  HPC: "04", "鉄骨プレ": "04",
  W: "05", 木造: "05",
  S: "06", Ｓ: "06", 鉄骨: "06",
  LS: "07", 軽量鉄骨: "07",
  ALC: "08", "気泡コン": "08",
  CB: "09", ブロック: "09",
  その他: "99",
};

// 間取りタイプ code
const MADORI_TYPE_CODE = {
  ワンルーム: "01", K: "02", Ｋ: "02", DK: "03", ＤＫ: "03",
  SDK: "04", LDK: "05", ＬＤＫ: "05", SLDK: "06",
  LK: "07", SK: "08", SLK: "09",
};

// ══════════════════════════════════════════════════════════
//  LOW-LEVEL HELPERS
// ══════════════════════════════════════════════════════════

/** fill input/textarea by ID */
async function fillById(f, id, value, label) {
  if (!value && value !== 0) return false;
  try {
    await f.fill(`#${id}`, String(value));
    console.log(`[forrent] + ${label}: "${value}"`);
    await f.waitForTimeout(200);
    return true;
  } catch (e) {
    console.log(`[forrent] x ${label}: ${e.message.slice(0, 60)}`);
    return false;
  }
}

/** fill input by Struts name attribute (handles ${} escaping via evaluate) */
async function fillByName(f, name, value, label) {
  if (!value && value !== 0) return false;
  try {
    const ok = await f.evaluate(({ n, v }) => {
      const el = document.querySelector(`[name="${n}"]`);
      if (!el) return false;
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
    }, { n: name, v: String(value) });
    console.log(`[forrent] ${ok ? "+" : "x"} ${label}: "${value}"`);
    return ok;
  } catch (e) {
    console.log(`[forrent] x ${label}: ${e.message.slice(0, 60)}`);
    return false;
  }
}

/** select option by value code, using Struts name attribute */
async function selectByName(f, name, code, label) {
  if (!code) return false;
  try {
    const ok = await f.evaluate(({ n, c }) => {
      const el = document.querySelector(`select[name="${n}"]`);
      if (!el) return false;
      const opt = Array.from(el.options).find(o => o.value === c);
      if (!opt) return false;
      el.value = c;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, { n: name, c: code });
    console.log(`[forrent] ${ok ? "+" : "x"} ${label}: code=${code}`);
    return ok;
  } catch (e) {
    console.log(`[forrent] x ${label}: ${e.message.slice(0, 60)}`);
    return false;
  }
}

/** select option by ID — tries value first, then label partial match */
async function selectById(f, id, text, label) {
  if (!text) return false;
  try {
    // 1. 完全一致（label）
    await f.selectOption(`#${id}`, { label: text });
    console.log(`[forrent] + ${label}: "${text}"`);
    await f.waitForTimeout(500);
    return true;
  } catch {
    // 2. 部分一致
    try {
      const val = await f.evaluate(({ elId, txt }) => {
        const el = document.getElementById(elId);
        if (!el) return null;
        const opts = Array.from(el.options);
        const m = opts.find(o => o.text.trim() === txt) ||
                  opts.find(o => o.text.includes(txt)) ||
                  opts.find(o => txt.includes(o.text.replace(/（.*）/, "").trim()));
        return m?.value ?? null;
      }, { elId: id, txt: text });
      if (val) {
        await f.selectOption(`#${id}`, val);
        console.log(`[forrent] + ${label}: "${text}" (partial match)`);
        await f.waitForTimeout(500);
        return true;
      }
    } catch {}
    console.log(`[forrent] x ${label}: "${text}" not found`);
    return false;
  }
}

/** set checkbox by ID */
async function setCheckbox(f, id, checked, label) {
  try {
    const current = await f.$eval(`#${id}`, el => el.checked);
    if (current !== checked) {
      await f.click(`#${id}`);
      console.log(`[forrent] + ${label}: ${checked ? "ON" : "OFF"}`);
      await f.waitForTimeout(200);
    }
    return true;
  } catch (e) {
    console.log(`[forrent] x ${label}: ${e.message.slice(0, 60)}`);
    return false;
  }
}

/** wait for cascade select to populate (options > 1) */
async function waitForCascade(f, selectId, timeoutMs = 5000) {
  try {
    await f.waitForFunction(
      (id) => {
        const el = document.getElementById(id);
        return el && el.options.length > 1;
      },
      selectId,
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    console.log(`[forrent] x cascade ${selectId}: timeout`);
    return false;
  }
}

// ══════════════════════════════════════════════════════════
//  LOGIN & NAVIGATION
// ══════════════════════════════════════════════════════════

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

async function navigateToNewProperty(page) {
  const naviFrame = page.frame({ name: "navi" });
  if (!naviFrame) throw new Error("Navi frame not found");
  await naviFrame.click(FORRENT_SELECTORS.navi.menuNewProperty);
  await page.waitForTimeout(5000);
  const mainFrame = page.frame({ name: "main" });
  if (!mainFrame) throw new Error("Main frame not found");
  return { mainFrame, title: await mainFrame.title() };
}

// ══════════════════════════════════════════════════════════
//  MAIN FORM FILL — 決定論的フィールドマッピング
// ══════════════════════════════════════════════════════════

async function fillPropertyForm(mainFrame, reinsData) {
  const filled = {};
  const errors = [];
  const ok = (name, result) => {
    if (result) filled[name] = true;
    else errors.push(name);
  };

  console.log("[forrent] === FORM FILL START ===");

  // ═══ 1. 棟情報 ═══

  // 物件名 — id="bukkenNm", max=35
  ok("物件名", await fillById(mainFrame, "bukkenNm", reinsData.建物名, "物件名"));

  // 地上階建 — id="kai", max=2
  const floors = norm(reinsData.地上階層)?.match(/(\d+)/)?.[1];
  if (floors) ok("地上階建", await fillById(mainFrame, "kai", floors, "地上階建"));

  // 地下階建 — id="chikaInput", max=1
  const bFloors = norm(reinsData.地下階層)?.match(/(\d+)/)?.[1];
  if (bFloors) ok("地下階建", await fillById(mainFrame, "chikaInput", bFloors, "地下階建"));

  // 階部分 — id="kaibubun", max=5
  const floor = norm(reinsData.所在階)?.match(/(\d+)/)?.[1];
  if (floor) ok("階部分", await fillById(mainFrame, "kaibubun", floor, "階部分"));

  // 号室 — id="heyaNoInput", max=10
  if (reinsData.部屋番号) ok("号室", await fillById(mainFrame, "heyaNoInput", reinsData.部屋番号, "号室"));

  // 物件種別 — select name="${bukkenInputForm.bukkenShuCd}"
  //   マンション(01), アパート(02), 一戸建て(11), テラス・タウンハウス(16), その他(99)
  if (reinsData.物件種目) {
    const code = PROPERTY_TYPE_CODE[norm(reinsData.物件種目)];
    if (code) ok("物件種別", await selectByName(mainFrame, `${S}bukkenShuCd}`, code, "物件種別"));
  }

  // 構造 — select name="${bukkenInputForm.kozoShuCd}"
  //   鉄筋コン(01)..その他(99)
  if (reinsData.建物構造) {
    const code = STRUCTURE_CODE[norm(reinsData.建物構造)];
    if (code) ok("構造", await selectByName(mainFrame, `${S}kozoShuCd}`, code, "構造"));
  }

  // 築年 — id="Wareki2Seireki1", max=4 (西暦)
  const chikuNorm = norm(reinsData.築年月);
  const yearM = chikuNorm?.match(/(\d{4})年/);
  if (yearM) ok("築年", await fillById(mainFrame, "Wareki2Seireki1", yearM[1], "築年"));

  // 築月 — name="${bukkenInputForm.chikuGetsu}", no id, max=2
  const monthM = chikuNorm?.match(/(\d{1,2})月/);
  if (monthM) ok("築月", await fillByName(mainFrame, `${S}chikuGetsu}`, monthM[1], "築月"));

  // 新築/中古 — #shinchikuKbnCd1(中古=2) がデフォルトON → そのまま

  // ═══ 2. 所在地 ═══

  // 都道府県 — id="todofukenList" (default=東京都)
  if (reinsData.都道府県名) {
    ok("都道府県", await selectById(mainFrame, "todofukenList", reinsData.都道府県名, "都道府県"));
    await mainFrame.waitForTimeout(1500);
  }

  // 市郡区 — id="shigunkuList" (cascade from 都道府県)
  if (reinsData.所在地名１) {
    ok("市郡区", await selectById(mainFrame, "shigunkuList", reinsData.所在地名１, "市郡区"));
    // 町村リストの読み込みを待つ
    await waitForCascade(mainFrame, "chosonList", 5000);
  }

  // 町村 — id="chosonList" (cascade from 市郡区)
  // REINS 所在地名２ は "神田神保町１丁目" のように丁目付きの場合がある
  // → chosonList には "神田神保町" のみなので、丁目部分を分離して aza 選択に使う
  let azaFromTown = null; // 所在地名２から抽出した丁目番号（半角）
  if (reinsData.所在地名２) {
    const townInput = norm(reinsData.所在地名２);
    const townSplit = townInput.match(/^(.+?)(\d+)丁目$/);
    if (townSplit) {
      // "神田神保町1丁目" → town="神田神保町", aza="1"
      ok("町村", await selectById(mainFrame, "chosonList", townSplit[1], "町村"));
      azaFromTown = townSplit[2]; // "1"
    } else {
      ok("町村", await selectById(mainFrame, "chosonList", townInput, "町村"));
    }
    // 字丁リストの読み込みを待つ
    await waitForCascade(mainFrame, "azaList", 5000);
  }

  // 字丁 — id="azaList" (cascade from 町村)
  // forrent.jp azaList の選択肢テキストは全角数字のみ: "１","２","３"
  // 丁目情報は 所在地名２ or 所在地名３ のどちらかに含まれる
  {
    const addr3 = norm(reinsData.所在地名３ || "");
    const azaFromAddr3 = addr3.match(/^(\d+)丁目/)?.[1] || null;
    const azaDigit = azaFromTown || azaFromAddr3;

    if (azaDigit) {
      // 半角→全角数字変換 (e.g. "1" → "１")
      const fullwidth = azaDigit.replace(/\d/g, c =>
        String.fromCharCode(c.charCodeAt(0) + 0xFEE0)
      );
      const azaOk = await selectById(mainFrame, "azaList", fullwidth, "字丁");
      ok("字丁", azaOk);
      await mainFrame.waitForTimeout(1000);
      // 残りを番地へ
      const rest = azaFromTown
        ? addr3  // 丁目は所在地名２にあった → 所在地名３は全て番地
        : addr3.replace(/^\d+丁目/, "").trim();
      if (rest) ok("番地", await fillById(mainFrame, "banchiNm", rest, "番地"));
    } else if (addr3) {
      // 丁目なし → 全部番地に入力
      ok("番地", await fillById(mainFrame, "banchiNm", addr3, "番地"));
    }
  }

  // ═══ 3. 会社間流通チェックボックス OFF ═══
  // id="bukkenNmDispFlg"   — 物件名を公開
  // id="heyaNoDispFlg"     — 部屋番号を公開
  // id="shosaiJushoDispFlg1" — 詳細住所を公開
  await setCheckbox(mainFrame, "bukkenNmDispFlg", false, "会社間流通:物件名");
  await setCheckbox(mainFrame, "heyaNoDispFlg", false, "会社間流通:部屋番号");
  await setCheckbox(mainFrame, "shosaiJushoDispFlg1", false, "会社間流通:詳細住所");

  // ═══ 4. お金 ═══
  await fillMoneyFields(mainFrame, reinsData, ok);

  // ═══ 5. 間取り ═══

  // 部屋数 — id="heyaCntInput", max=2
  const rooms = norm(reinsData.間取部屋数)?.match(/(\d+)/)?.[1];
  if (rooms) ok("部屋数", await fillById(mainFrame, "heyaCntInput", rooms, "部屋数"));

  // 間取りタイプ — select name="${bukkenInputForm.madoriTypeKbnCd}"
  //   ワンルーム(01), K(02), DK(03), SDK(04), LDK(05), SLDK(06), LK(07), SK(08), SLK(09)
  if (reinsData.間取タイプ) {
    const code = MADORI_TYPE_CODE[norm(reinsData.間取タイプ)];
    if (code) ok("間取りタイプ", await selectByName(mainFrame, `${S}madoriTypeKbnCd}`, code, "間取りタイプ"));
  }

  // 面積 — id="mensekiIntegerInput"(max=3) + id="mensekiDecimalInput"(max=2)
  const areaStr = norm(reinsData.使用部分面積)?.replace(/㎡|m2/gi, "");
  if (areaStr) {
    const parts = areaStr.split(".");
    ok("面積(整数)", await fillById(mainFrame, "mensekiIntegerInput", parts[0], "面積(整数)"));
    ok("面積(小数)", await fillById(mainFrame, "mensekiDecimalInput", parts[1] || "00", "面積(小数)"));
  }

  // ═══ 6. 入居時期 ═══
  // nyukyoKbnCd1(即=1), nyukyoKbnCd2(相談=2), nyukyoKbnCd3(年月=3)
  if (reinsData.入居時期) {
    const nyukyo = norm(reinsData.入居時期);
    if (/即/.test(nyukyo)) {
      await mainFrame.click("#nyukyoKbnCd1").catch(() => {});
      ok("入居時期", true);
    } else if (/相談/.test(nyukyo)) {
      await mainFrame.click("#nyukyoKbnCd2").catch(() => {});
      ok("入居時期", true);
    } else {
      // 年月指定
      await mainFrame.click("#nyukyoKbnCd3").catch(() => {});
      ok("入居時期", true);
    }
    await mainFrame.waitForTimeout(300);
  }

  // ═══ 7. 取引態様 ═══
  // torihikiTaiyoKbnCd: 貸主(1), 代理(2), 仲介元付(3), 仲介先物(4)
  if (reinsData.取引態様) {
    const t = norm(reinsData.取引態様);
    let code = null;
    if (/貸主/.test(t)) code = "1";
    else if (/代理/.test(t)) code = "2";
    else if (/仲介元付|元付/.test(t)) code = "3";
    else if (/仲介先物|先物|仲介/.test(t)) code = "4";
    else if (/媒介/.test(t)) code = "3"; // 媒介 = 仲介元付として扱う
    if (code) {
      try {
        await mainFrame.selectOption("#torihikiTaiyoKbnCd", code);
        console.log(`[forrent] + 取引態様: code=${code} (${t})`);
        filled["取引態様"] = true;
      } catch (e) {
        console.log(`[forrent] x 取引態様: ${e.message.slice(0, 60)}`);
        errors.push("取引態様");
      }
    }
  }

  console.log("[forrent] === FORM FILL END ===");
  console.log(`[forrent] OK: ${Object.keys(filled).length}, NG: ${errors.length}`);
  if (errors.length > 0) console.log(`[forrent] ERRORS: ${errors.join(", ")}`);

  return { filled, errors };
}

// ── お金フィールド ──
async function fillMoneyFields(f, data, ok) {
  // ── 賃料: chinryo1(万) + chinryo2(千) ──
  // REINS: "7.0万円" → chinryo1="7", chinryo2="0"
  // REINS: "10.5万円" → chinryo1="10", chinryo2="5"
  const rentM = norm(data.賃料)?.match(/([\d.]+)万/);
  if (rentM) {
    const man = parseFloat(rentM[1]);
    const c1 = Math.floor(man);
    const c2 = Math.round((man - c1) * 10); // 千の位
    ok("賃料(万)", await fillByName(f, `${S}chinryo1}`, String(c1), "賃料(万)"));
    ok("賃料(千)", await fillByName(f, `${S}chinryo2}`, String(c2), "賃料(千)"));
  }

  // ── 管理費/共益費: kanrihi1(万) + kanrihi2(円) ──
  // REINS: "5,000円" → kanrihi1="", kanrihi2="5000"
  const mgmtM = norm(data.共益費)?.match(/([\d,]+)円/);
  if (mgmtM) {
    const yen = parseInt(mgmtM[1].replace(/,/g, ""));
    const man = Math.floor(yen / 10000);
    const rem = yen % 10000;
    if (man > 0) ok("管理費(万)", await fillByName(f, `${S}kanrihi1}`, String(man), "管理費(万)"));
    ok("管理費(円)", await fillByName(f, `${S}kanrihi2}`, String(rem), "管理費(円)"));
  } else if (norm(data.共益費)?.match(/なし|ー|0/)) {
    await setCheckbox(f, "kanrihiFlg", false, "管理費フラグ");
  }

  // ── 敷金: shikikin1 + shikikin2 + shikikinKbnCd(ヶ月=1/万円=2) ──
  await fillDeposit(f, data.敷金, {
    flgId: "shikikinFlg",
    n1: `${S}shikikin1}`, n2: `${S}shikikin2}`,
    monthId: "shikikinKbnCd1", yenId: "shikikinKbnCd2",
    label: "敷金",
  }, ok);

  // ── 礼金: reikin1 + reikin2 + reikinKbnCd(ヶ月=1/万円=2) ──
  await fillDeposit(f, data.礼金, {
    flgId: "reikinFlg",
    n1: `${S}reikin1}`, n2: `${S}reikin2}`,
    monthId: "reikinKbnCd1", yenId: "reikinKbnCd2",
    label: "礼金",
  }, ok);
}

/** 敷金/礼金: "1ヶ月" or "10万円" or "なし" */
async function fillDeposit(f, raw, cfg, ok) {
  if (!raw || raw === "ー" || /なし|0|^$/.test(raw)) {
    await setCheckbox(f, cfg.flgId, false, `${cfg.label}フラグ`);
    return;
  }
  // "1ヶ月", "2ヶ月" pattern
  const monthM = raw.match(/(\d+\.?\d*)ヶ?月/);
  if (monthM) {
    await f.click(`#${cfg.monthId}`).catch(() => {});
    await f.waitForTimeout(200);
    ok(`${cfg.label}`, await fillByName(f, cfg.n1, monthM[1], `${cfg.label}(ヶ月)`));
    return;
  }
  // "10万円", "10.5万円" pattern
  const yenM = raw.match(/([\d.]+)万/);
  if (yenM) {
    await f.click(`#${cfg.yenId}`).catch(() => {});
    await f.waitForTimeout(200);
    const v = parseFloat(yenM[1]);
    ok(`${cfg.label}(万)`, await fillByName(f, cfg.n1, String(Math.floor(v)), `${cfg.label}(万)`));
    const sen = Math.round((v - Math.floor(v)) * 10);
    if (sen > 0) ok(`${cfg.label}(千)`, await fillByName(f, cfg.n2, String(sen), `${cfg.label}(千)`));
    return;
  }
  console.log(`[forrent] ? ${cfg.label}: unknown format "${raw}"`);
}

// ══════════════════════════════════════════════════════════
//  交通 直接入力 — evaluate() で DOM を直接操作
//  (らくらくポップアップはonclickがフォームPOSTしてフレーム離脱を起こすため使わない)
// ══════════════════════════════════════════════════════════

async function fillTransportDirect(mainFrame, transportArray) {
  const filled = [];
  const errors = [];
  if (!transportArray?.length) return { filled, errors };

  // 交通1-3のフィールドID
  const slots = [
    { ensen: "pkgEnsenNmDisp",  eki: "pkgEkiNmDisp",  radio: "toho",  fun: "tohofun" },
    { ensen: "pkgEnsenNmDisp2", eki: "pkgEkiNmDisp2", radio: "toho2", fun: "tohofun2" },
    { ensen: "pkgEnsenNmDisp3", eki: "pkgEkiNmDisp3", radio: "toho3", fun: "tohofun3" },
  ];

  for (let i = 0; i < Math.min(transportArray.length, 3); i++) {
    const t = transportArray[i];
    const slot = slots[i];
    const ensen = norm(t.沿線 || "");
    const eki = norm(t.駅 || "");
    const walk = String(parseInt(t.徒歩) || 0);

    try {
      // evaluate() で直接 DOM 操作 — Playwright actionability チェックをバイパス
      const result = await mainFrame.evaluate(({ slot, ensen, eki, walk }) => {
        const out = [];

        // 沿線名
        const ensenEl = document.getElementById(slot.ensen);
        if (ensenEl) { ensenEl.value = ensen; out.push(`沿線=${ensen}`); }

        // 駅名
        const ekiEl = document.getElementById(slot.eki);
        if (ekiEl) { ekiEl.value = eki; out.push(`駅=${eki}`); }

        // 徒歩ラジオボタン
        const radioEl = document.getElementById(slot.radio);
        if (radioEl) { radioEl.checked = true; out.push("徒歩=checked"); }

        // 徒歩分数
        const funEl = document.getElementById(slot.fun);
        if (funEl && walk !== "0") { funEl.value = walk; out.push(`分数=${walk}`); }

        return out;
      }, { slot, ensen, eki, walk });

      if (result.length > 0) {
        filled.push(`交通${i + 1}: ${eki}駅 徒歩${walk}分`);
        console.log(`[forrent] transport ${i + 1}: ${result.join(", ")}`);
      }
    } catch (e) {
      errors.push(`交通${i + 1}: ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`[forrent] transport: ${filled.length} filled, ${errors.length} errors`);
  return { filled, errors };
}

// 旧ポップアップ版（互換性のため残す）
async function fillTransportRakuraku(mainFrame, transportArray) {
  return fillTransportDirect(mainFrame, transportArray);
}

// ══════════════════════════════════════════════════════════
//  テキスト入力
// ══════════════════════════════════════════════════════════

async function fillTexts(mainFrame, catchCopy, freeComment) {
  const errors = [];

  // evaluate() で直接 DOM 操作（フレーム状態に左右されにくい）
  try {
    const result = await mainFrame.evaluate(({ catchCopy, freeComment }) => {
      const out = [];
      const fields = [
        { id: "bukkenCatch", val: catchCopy },
        { id: "netCatch", val: catchCopy },
        { id: "netFreeMemo", val: freeComment },
        { id: "freeMemo", val: freeComment },
      ];
      for (const f of fields) {
        const el = document.getElementById(f.id);
        if (el) {
          el.value = f.val;
          out.push(f.id);
        } else {
          out.push(`!${f.id}`);
        }
      }
      return out;
    }, { catchCopy, freeComment });

    const ok = result.filter(r => !r.startsWith("!"));
    const ng = result.filter(r => r.startsWith("!")).map(r => r.slice(1));
    for (const id of ng) errors.push(`${id}: element not found`);
    console.log(`[forrent] texts: ${ok.length} filled (${ok.join(", ")}), ${ng.length} missing`);
  } catch (e) {
    errors.push(`texts: ${e.message.slice(0, 80)}`);
  }

  return errors;
}

// ══════════════════════════════════════════════════════════
//  画像アップロード
// ══════════════════════════════════════════════════════════

/**
 * forrent.jp 画像スロット構造:
 *
 * 固定スロット:
 *   - 外観:   file_up_gaikan   (+ gaikanMemo)
 *   - パース: file_up_perth    (+ perthMemo)
 *   - 室内:   file_up_shitsunai (+ shitsunaiShashinCategory + shitsunaiMemo)
 *   - 地図:   file_up_map
 *   - 周辺環境: file_up_shuhenkankyo
 *
 * 可変スロット:
 *   - 写真1-3:     file_up_shashin{1-3}    (+ shashin{N}Category + shashin{N}Memo)
 *   - 追加画像1-8: file_up_tsuikaGazo{1-8} (+ tsuikaGazo{N}Category + tsuikaGazo{N}Memo(id=tsuikaGazo{N}))
 *
 * 周辺環境6スロット:
 *   - file_up_shuhenKankyo{1-6} (+ categoryCd + shuhenKankyoNm + kyori)
 */

/**
 * ファイル入力ヘルパー — name属性 + 可視性 + 親の可視性で正しい要素を特定
 * (forrent.jpはフォーム内でfile input が最大8回重複するため、
 *  表示中セクション内の要素を確実に特定する必要がある)
 */
async function setFileInput(frame, inputName, filePath) {
  // Step 1: 全候補を評価し、最も適切な要素のインデックスを取得
  const info = await frame.evaluate((name) => {
    const all = [...document.querySelectorAll(`input[type="file"][name="${name}"]`)];
    if (!all.length) return { total: 0, bestIdx: -1 };

    const candidates = all.map((el, i) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const parentStyle = el.parentElement ? window.getComputedStyle(el.parentElement) : null;
      return {
        idx: i,
        visible: style.display !== "none" && style.visibility !== "hidden",
        parentVisible: parentStyle ? parentStyle.display !== "none" : true,
        hasSize: rect.width > 0 && rect.height > 0,
        inViewport: rect.top >= 0 && rect.top < document.documentElement.scrollHeight,
      };
    });

    // 優先順位: visible + parentVisible + hasSize
    const best = candidates.find(c => c.visible && c.parentVisible && c.hasSize)
      || candidates.find(c => c.visible && c.parentVisible)
      || candidates.find(c => c.visible)
      || candidates[0];

    return { total: all.length, bestIdx: best?.idx ?? -1, candidates };
  }, inputName);

  if (info.total === 0 || info.bestIdx === -1) {
    console.log(`[forrent] x file: ${inputName} not found (0 elements)`);
    return false;
  }

  // Step 2: 特定のインデックスの要素にファイルをセット
  const handle = await frame.evaluateHandle(({ name, idx }) => {
    return document.querySelectorAll(`input[type="file"][name="${name}"]`)[idx];
  }, { name: inputName, idx: info.bestIdx });

  const el = handle.asElement();
  if (!el) {
    await handle.dispose();
    return false;
  }

  await el.setInputFiles(filePath);

  // Step 3: 検証 — ファイルがセットされたか確認
  const verified = await frame.evaluate(({ name, idx }) => {
    const el = document.querySelectorAll(`input[type="file"][name="${name}"]`)[idx];
    return el?.files?.length > 0;
  }, { name: inputName, idx: info.bestIdx });

  await handle.dispose();

  if (!verified) {
    console.log(`[forrent] ! file: ${inputName} setInputFiles succeeded but files.length=0 (${info.total} elements, idx=${info.bestIdx})`);
  }

  return verified;
}

// image-ai.js カテゴリ → forrent.jp スロット マッピング
const GAIKAN_CATS = ["外観", "共用部"];
const INTERIOR_CATS = ["居室・リビング", "洋室", "和室", "キッチン", "バス・シャワー",
  "トイレ", "洗面所", "玄関", "収納", "バルコニー"];
const SHUHEN_CATS = ["周辺環境"];
// "間取り図" → shashin枠へ（forrent.jpに間取り専用fileスロットがないため）

async function uploadImages(mainFrame, processedImages) {
  const uploaded = [];
  const errors = [];

  const items = (processedImages || []).map(img =>
    typeof img === "string" ? { localPath: img } : img
  );
  if (!items.length) return { uploaded, errors };

  // 画像セクションへスクロール
  await mainFrame.evaluate(() => {
    const a = document.querySelector('[name="gazou"]');
    if (a) a.scrollIntoView();
  }).catch(() => {});
  await mainFrame.waitForTimeout(1000);

  // スロット使用トラッカー
  let gaikanDone = false, shitsunaiDone = false;
  let shashinN = 1;  // 1-3
  let tsuikaN = 1;   // 1-8
  let shuhenN = 1;   // 1-6

  for (const img of items) {
    const cat = img.categoryLabel || "";
    let inputName = null;

    // カテゴリ → スロット割り当て
    if (GAIKAN_CATS.includes(cat) && !gaikanDone) {
      inputName = "gaikanFile"; gaikanDone = true;
    } else if (INTERIOR_CATS.includes(cat) && !shitsunaiDone) {
      inputName = "shitsunaiFile"; shitsunaiDone = true;
    } else if (SHUHEN_CATS.includes(cat) && shuhenN <= 6) {
      inputName = `shuhenKankyo${shuhenN++}File`;
    } else if (shashinN <= 3) {
      inputName = `shashin${shashinN++}File`;
    } else if (tsuikaN <= 8) {
      inputName = `tsuikaGazo${tsuikaN++}File`;
    } else {
      errors.push(`slot overflow: ${img.localPath}`);
      continue;
    }

    try {
      const ok = await setFileInput(mainFrame, inputName, img.localPath);
      if (ok) {
        uploaded.push(img.localPath);
        console.log(`[forrent] + image: ${inputName} <- ${img.localPath.split("/").pop()}`);
      } else {
        console.log(`[forrent] x image: ${inputName} not found in DOM`);
        errors.push(`image(${inputName}): element not found`);
      }
      await mainFrame.waitForTimeout(1500);
    } catch (e) {
      console.log(`[forrent] x image: ${inputName}: ${e.message.slice(0, 80)}`);
      errors.push(`image(${inputName}): ${e.message.slice(0, 60)}`);
    }
  }

  console.log(`[forrent] images: ${uploaded.length} uploaded, ${errors.length} errors`);
  return { uploaded, errors };
}

// ── Utilities ──

function norm(str) {
  if (!str) return "";
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .trim();
}


module.exports = {
  login,
  navigateToNewProperty,
  fillPropertyForm,
  fillTransportDirect,
  fillTransportRakuraku,
  fillTexts,
  uploadImages,
};
