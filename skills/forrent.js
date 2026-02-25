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

  // ドラフト復元ダイアログが出ている場合は削除して新規開始
  const hasDraft = await mainFrame.evaluate(() => {
    const btn = document.getElementById("deleteDraftButton");
    if (btn && btn.offsetParent !== null) return true;
    return false;
  });
  if (hasDraft) {
    console.log("[forrent] ドラフト検出 → 削除して新規物件登録");
    await mainFrame.click("#deleteDraftButton");
    await page.waitForTimeout(2000);
    // 確認ダイアログが出る場合
    const yesBtn = await mainFrame.$("#yesDeleteDraftButton");
    if (yesBtn) {
      await yesBtn.click();
      await page.waitForTimeout(3000);
    }
  }

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
  // 優先順位: 1) 所在階が有効な数字, 2) 部屋番号から推定（901→9, 1201→12）
  let floor = null;
  const rawFloor = norm(reinsData.所在階 || "");
  console.log(`[forrent] debug: 所在階="${reinsData.所在階}", norm="${rawFloor}", 部屋番号="${reinsData.部屋番号}"`);
  if (/^\d+$/.test(rawFloor)) {
    floor = rawFloor;
  } else if (reinsData.部屋番号) {
    const digits = norm(reinsData.部屋番号).replace(/\D/g, "");
    if (digits.length >= 3) {
      floor = String(parseInt(digits.slice(0, -2), 10)); // 901→9, 1201→12
    }
    console.log(`[forrent] debug: digits="${digits}", floor="${floor}"`);
  }
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

  // ═══ 8. ★マーク（客付可） ═══
  // hoshiFlg1=あり(1), hoshiFlg2=なし(0) — 必須選択
  ok("★マーク", await mainFrame.evaluate(() => {
    const el = document.getElementById("hoshiFlg1");
    if (el) {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }));
  if (filled["★マーク"]) console.log("[forrent] + ★マーク: あり");

  // ═══ 9. 地図表示 ═══
  // mapHyojiFlg — ネットの地図上で物件を表示する
  await setCheckbox(mainFrame, "mapHyojiFlg", true, "地図表示");
  filled["地図表示"] = true;

  // ═══ 10. 条件radioボタン ═══
  // 各条件のデフォルト: 可(1)/不可(2)/相談(3) — REINSデータがなければ「相談(3)」or「可(1)」
  await fillConditionRadios(mainFrame, reinsData, ok);

  // ═══ 11. 仲介手数料 ═══
  // chukaiTesuryoFlg1=あり(1) — 仲介先物の場合は「あり」
  if (reinsData.取引態様 && !/貸主/.test(norm(reinsData.取引態様))) {
    ok("仲介手数料", await mainFrame.evaluate(() => {
      const el = document.getElementById("chukaiTesuryoFlg1");
      if (el) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); return true; }
      return false;
    }));
  }

  // ═══ 12. 管理形態 ═══
  // kanriKeitaiKbnCd: 自主管理(1), 委託管理(2), 巡回管理(3), 指定なし(4)
  ok("管理形態", await mainFrame.evaluate(() => {
    // 「指定なし」(4) を選択
    const radios = document.querySelectorAll('input[type="radio"][name="${bukkenInputForm.kanriKeitaiKbnCd}"]');
    for (const r of radios) {
      if (r.value === "4") { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    }
    return false;
  }));

  // ═══ 13. 省エネルギー ═══
  // energyKbnCd: 該当なし(1), 省エネ基準適合(2), 低炭素建築物(3)
  ok("省エネ", await mainFrame.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"][name="${bukkenInputForm.energyKbnCd}"]');
    for (const r of radios) {
      if (r.value === "1") { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    }
    return false;
  }));

  // ═══ 14. 定期借家 ═══
  // teikiShakuyaFlg: あり(1)/なし(2) — REINS「定期借家」情報があれば
  {
    const isTeiki = reinsData.備考3 && /定期借家|定借/.test(norm(reinsData.備考3));
    const teikiVal = isTeiki ? "1" : "2";
    ok("定期借家", await mainFrame.evaluate((val) => {
      const radios = document.querySelectorAll('input[type="radio"][name="${bukkenInputForm.teikiShakuyaFlg}"]');
      for (const r of radios) {
        if (r.value === val) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); return true; }
      }
      return false;
    }, teikiVal));
  }

  // ═══ 15. 保証人代行 ═══
  // hoshoninDaikoKbnCd: 利用必須(1)/利用可(2)/なし(3)
  ok("保証人代行", await mainFrame.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"][name="${bukkenInputForm.hoshoninDaikoKbnCd}"]');
    // デフォルト: 利用可(2)
    for (const r of radios) {
      if (r.value === "2") { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); return true; }
    }
    return false;
  }));

  // ═══ 16. BB(ブロードバンド)対応 ═══
  // bbCpyKbnCd: 光ファイバー(1), CATV(2), ADSL(3), 高速(4), 対応(5), なし(6)...
  // デフォルト: 「なし」を選択（不明な場合）
  ok("BB対応", await mainFrame.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"][name="${bukkenInputForm.bbCpyKbnCd}"]');
    // 最後の選択肢を選ぶ（通常「なし」or「未確認」）
    if (radios.length > 0) {
      const last = radios[radios.length - 1];
      last.checked = true;
      last.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }));

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

// ── 条件radioボタン一括設定 ──
// 入居条件 (法人/学生/性別/単身/二人/子ども/ペット/楽器/事務所/ルームシェア)
// REINSデータから判別できる場合はそちらを優先、不明なら「相談(3)」or「可(1)」
async function fillConditionRadios(mainFrame, reinsData, ok) {
  // 各条件: [radioName, defaultValue, label]
  // 値: 1=可, 2=不可, 3=相談 (項目によって2択or3択)
  const conditions = [
    ["hojinKbnCd", "1", "法人入居"],      // 可(1)/不可(2)/相談(3)
    ["gakuseiKbnCd", "1", "学生"],         // 可(1)/不可(2)/相談(3)
    ["seibetsuKbnCd", "1", "男女"],        // 不問(1)/男性のみ(2)/女性のみ(3)
    ["tanshinKbnCd", "1", "単身"],         // 可(1)/不可(2)/相談(3)
    ["futariKbnCd", "1", "二人入居"],      // 可(1)/不可(2)
    ["kodomoKbnCd", "1", "子ども"],        // 可(1)/不可(2)/相談(3)
    ["petKbnCd", "2", "ペット"],           // 可(1)/不可(2) — デフォルト不可
    ["gakkiKbnCd", "2", "楽器"],           // 可(1)/不可(2) — デフォルト不可
    ["jimushoRiyoKbnCd", "2", "事務所利用"],// 可(1)/不可(2)/相談(3)
    ["roomShareKbnCd", "2", "ルームシェア"],// 可(1)/不可(2)/相談(3)
  ];

  // REINSデータから条件を推測
  const reinsConditions = {};
  const setsubi = norm(reinsData.設備 || "");
  const biko = norm(reinsData.備考 || reinsData.特記事項 || "");
  const jouken = norm(reinsData.入居条件 || "");
  const combined = [setsubi, biko, jouken].join(" ");

  if (/ペット可|ペット相談|ペット飼育/.test(combined)) reinsConditions.petKbnCd = "1";
  if (/楽器可|楽器相談/.test(combined)) reinsConditions.gakkiKbnCd = "1";
  if (/事務所可|SOHO|事務所利用/.test(combined)) reinsConditions.jimushoRiyoKbnCd = "1";
  if (/ルームシェア可/.test(combined)) reinsConditions.roomShareKbnCd = "1";
  if (/法人不可/.test(combined)) reinsConditions.hojinKbnCd = "2";
  if (/単身限定|単身のみ/.test(combined)) {
    reinsConditions.futariKbnCd = "2";
    reinsConditions.kodomoKbnCd = "2";
  }
  if (/女性限定|女性専用/.test(combined)) reinsConditions.seibetsuKbnCd = "3";
  if (/男性限定|男性専用/.test(combined)) reinsConditions.seibetsuKbnCd = "2";

  let filledCount = 0;
  for (const [name, defaultVal, label] of conditions) {
    const val = reinsConditions[name] || defaultVal;
    const result = await mainFrame.evaluate(({ name, val }) => {
      const selector = `input[type="radio"][name="\${bukkenInputForm.${name}}"]`;
      const radios = document.querySelectorAll(selector);
      for (const r of radios) {
        if (r.value === val) {
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, { name, val });
    if (result) filledCount++;
  }
  ok("入居条件", filledCount > 0);
  console.log(`[forrent] + 入居条件: ${filledCount}/${conditions.length}項目設定`);
}

// ══════════════════════════════════════════════════════════
//  交通 直接入力 — evaluate() で DOM を直接操作
//  (らくらくポップアップはonclickがフォームPOSTしてフレーム離脱を起こすため使わない)
// ══════════════════════════════════════════════════════════

/**
 * 地図修正 + らくらく交通入力 による交通設定
 *
 * フロー:
 * 1. chizuShuseiボタンをクリック → ポップアップで自動ジオコーディング
 * 2. 座標を tmpIdoFull/tmpKeidoFull から idoFull/keidoFull にコピー
 * 3. rakurakuKotsuボタンをクリック → ポップアップで最寄り駅を自動選択
 *
 * 注意: rakurakuKotsuのonclickはフォームPOSTを含むため、
 *       ポップアップハンドリングが必要
 */
async function fillTransportViaMap(page, mainFrame, transportArray) {
  const filled = [];
  const errors = [];

  console.log("[forrent] === TRANSPORT VIA MAP ===");

  // ═══ Step 1: 地図修正ボタンクリック → registryXY()で登録 ═══
  try {
    console.log("[forrent] Step 1: 地図修正（chizuShusei）");

    const popupPromise = page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null);
    await mainFrame.evaluate(() => {
      const btn = document.getElementById("chizuShusei");
      if (btn) btn.click();
    });

    const mapPopup = await popupPromise;
    if (mapPopup) {
      console.log(`[forrent] 地図ポップアップ検出: ${mapPopup.url()}`);
      await mapPopup.waitForLoadState("networkidle").catch(() => {});
      await mapPopup.waitForTimeout(3000);

      // 「登録」ボタン = <IMG onclick="registryXY();"> をクリック
      // registryXY()はポップアップを自動で閉じるので、evaluate後にpage closedエラーが出る可能性あり
      const registered = await mapPopup.evaluate(() => {
        const imgs = [...document.querySelectorAll("img[onclick*='registryXY']")];
        if (imgs.length > 0) { imgs[0].click(); return "onclick"; }
        if (typeof window.registryXY === "function") { window.registryXY(); return "direct"; }
        return null;
      }).catch((e) => {
        // ポップアップが閉じた場合のエラーは無視（registryXY成功の証拠）
        if (e.message.includes("closed") || e.message.includes("detach")) return "closed-ok";
        return null;
      });

      console.log(`[forrent] 地図ポップアップ: 登録結果=${registered}`);
      // ポップアップが閉じるのを少し待つ
      await mainFrame.waitForTimeout(2000);
      if (!mapPopup.isClosed()) await mapPopup.close().catch(() => {});
    }

    // 座標の確認（registryXY()がparentに反映したはず）
    const coordResult = await mainFrame.evaluate(() => {
      const ido = document.getElementById("idoFull")?.value || "";
      const keido = document.getElementById("keidoFull")?.value || "";
      const tmpIdo = document.getElementById("tmpIdoFull")?.value || "";
      const tmpKeido = document.getElementById("tmpKeidoFull")?.value || "";
      // registryXY()がidoFull/keidoFullを設定しなかった場合、手動コピー
      if (!ido && tmpIdo) {
        document.getElementById("idoFull").value = tmpIdo;
        document.getElementById("keidoFull").value = tmpKeido;
        const flg = document.getElementById("idokeidoNoDisp");
        if (flg) flg.value = "0";
        return { ido: tmpIdo, keido: tmpKeido, source: "manual-copy" };
      }
      return ido ? { ido, keido, source: "registryXY" } : null;
    });

    if (coordResult) {
      console.log(`[forrent] 座標セット: ido=${coordResult.ido}, keido=${coordResult.keido} (${coordResult.source})`);
    } else {
      console.log("[forrent] 座標取得失敗 → フォールバック");
      return fillTransportDirect(mainFrame, transportArray);
    }

  } catch (e) {
    console.log(`[forrent] 地図修正エラー: ${e.message.slice(0, 100)}`);
    return fillTransportDirect(mainFrame, transportArray);
  }

  // ═══ Step 2: らくらく交通入力 ═══
  try {
    console.log("[forrent] Step 2: らくらく交通入力（rakurakuKotsu）");

    const transportPopupPromise = page.context().waitForEvent("page", { timeout: 15000 }).catch(() => null);
    await mainFrame.evaluate(() => {
      const btn = document.getElementById("rakurakuKotsu");
      if (btn) btn.click();
    });

    const transportPopup = await transportPopupPromise;
    if (transportPopup) {
      console.log(`[forrent] 交通ポップアップ検出: ${transportPopup.url()}`);
      await transportPopup.waitForLoadState("networkidle").catch(() => {});
      await transportPopup.waitForTimeout(3000);

      // ラジオボタンを選択: 交通1=候補1, 交通2=候補2, 交通3=候補3
      // （同一候補は選択不可のため、各スロットに異なる候補を割り当て）
      const radioResult = await transportPopup.evaluate(() => {
        const selections = [
          { id: "koutu_1-1", slot: 1, candidate: 1 },
          { id: "koutu_2-2", slot: 2, candidate: 2 },
          { id: "koutu_3-3", slot: 3, candidate: 3 },
        ];
        const results = [];
        for (const sel of selections) {
          const radio = document.getElementById(sel.id);
          if (radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            radio.dispatchEvent(new Event("click", { bubbles: true }));
            results.push(`交通${sel.slot}=候補${sel.candidate}`);
          }
        }
        return results;
      });
      console.log(`[forrent] ラジオ選択: ${radioResult.join(", ")}`);

      // hidden fieldsから候補データを読み取り
      const candidates = await transportPopup.evaluate(() => {
        const out = [];
        for (let i = 1; i <= 4; i++) {
          const ensenNm = document.getElementById(`ensenNm${i}`)?.value || "";
          const ensenCd = document.getElementById(`ensenCd${i}`)?.value || "";
          const ekiNm = document.getElementById(`ekiNm${i}`)?.value || "";
          const ekiCd = document.getElementById(`ekiCd${i}`)?.value || "";
          const fun = document.getElementById(`tohofun${i}`)?.value || "";
          if (ensenNm) out.push({ idx: i, ensenNm, ensenCd, ekiNm, ekiCd, fun });
        }
        return out;
      });
      for (const c of candidates) {
        console.log(`[forrent] 候補${c.idx}: ${c.ensenNm}/${c.ekiNm} 徒歩${c.fun}分 (cd:${c.ensenCd}/${c.ekiCd})`);
      }

      // 「登録」ボタンクリック: <IMG id="registButton">
      // クリック後にポップアップが閉じる可能性あり
      await transportPopup.waitForTimeout(1000);
      const registClicked = await transportPopup.evaluate(() => {
        const btn = document.getElementById("registButton");
        if (btn) { btn.click(); return true; }
        const imgs = [...document.querySelectorAll("img")];
        const regImg = imgs.find(i => i.src?.includes("toroku"));
        if (regImg) { regImg.click(); return true; }
        return false;
      }).catch((e) => {
        if (e.message.includes("closed") || e.message.includes("detach")) return true;
        return false;
      });

      console.log(`[forrent] 交通ポップアップ: 登録=${registClicked}`);
      // parent frameの更新を待つ
      await mainFrame.waitForTimeout(3000);
      if (!transportPopup.isClosed()) await transportPopup.close().catch(() => {});

      // mainFrameの交通フィールドが設定されたか確認
      await mainFrame.waitForTimeout(1000);
      const transportResult = await mainFrame.evaluate(() => {
        const out = [];
        const ids = [
          { disp: "pkgEnsenNmDisp", cd: "pkgEnsenCd", ekiDisp: "pkgEkiNmDisp", ekiCd: "pkgEkiCd", fun: "tohofun" },
          { disp: "pkgEnsenNmDisp2", cd: "pkgEnsenCd2", ekiDisp: "pkgEkiNmDisp2", ekiCd: "pkgEkiCd2", fun: "tohofun2" },
          { disp: "pkgEnsenNmDisp3", cd: "pkgEnsenCd3", ekiDisp: "pkgEkiNmDisp3", ekiCd: "pkgEkiCd3", fun: "tohofun3" },
        ];
        for (const slot of ids) {
          const ensen = document.getElementById(slot.disp)?.value || "";
          const ensenCd = document.getElementById(slot.cd)?.value || "";
          const eki = document.getElementById(slot.ekiDisp)?.value || "";
          const ekiCd = document.getElementById(slot.ekiCd)?.value || "";
          const fun = document.getElementById(slot.fun)?.value || "";
          out.push({ ensen, ensenCd, eki, ekiCd, fun });
        }
        return out;
      });

      for (const t of transportResult) {
        if (t.ensen || t.eki || t.ensenCd) {
          filled.push(`${t.ensen} ${t.eki} 徒歩${t.fun}分 (cd:${t.ensenCd}/${t.ekiCd})`);
          console.log(`[forrent] transport: ${t.ensen} ${t.eki} 徒歩${t.fun}分 code=${t.ensenCd}/${t.ekiCd}`);
        }
      }

      if (filled.length === 0) {
        console.log("[forrent] らくらく交通入力 結果なし → フォールバック");
        return fillTransportDirect(mainFrame, transportArray);
      }

    } else {
      console.log("[forrent] 交通ポップアップなし → フォールバック");
      return fillTransportDirect(mainFrame, transportArray);
    }

  } catch (e) {
    console.log(`[forrent] らくらく交通入力エラー: ${e.message.slice(0, 100)}`);
    return fillTransportDirect(mainFrame, transportArray);
  }

  console.log(`[forrent] transport via map: ${filled.length} filled, ${errors.length} errors`);
  return { filled, errors };
}

// evaluate直入力フォールバック
async function fillTransportDirect(mainFrame, transportArray) {
  const filled = [];
  const errors = [];
  if (!transportArray?.length) return { filled, errors };

  const slots = [
    { ensen: "pkgEnsenNmDisp",  eki: "pkgEkiNmDisp",  radio: "toho",  fun: "tohofun",
      ensenNm: "pkgEnsenNm", ekiNm: "pkgEkiNm" },
    { ensen: "pkgEnsenNmDisp2", eki: "pkgEkiNmDisp2", radio: "toho2", fun: "tohofun2",
      ensenNm: "pkgEnsenNm2", ekiNm: "pkgEkiNm2" },
    { ensen: "pkgEnsenNmDisp3", eki: "pkgEkiNmDisp3", radio: "toho3", fun: "tohofun3",
      ensenNm: "pkgEnsenNm3", ekiNm: "pkgEkiNm3" },
  ];

  for (let i = 0; i < Math.min(transportArray.length, 3); i++) {
    const t = transportArray[i];
    const slot = slots[i];
    const ensen = norm(t.沿線 || "");
    const eki = norm(t.駅 || "");
    const walk = String(parseInt(t.徒歩) || 0);

    try {
      const result = await mainFrame.evaluate(({ slot, ensen, eki, walk }) => {
        const out = [];
        const fire = (el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const ensenEl = document.getElementById(slot.ensen);
        if (ensenEl) { ensenEl.value = ensen; fire(ensenEl); out.push(`沿線=${ensen}`); }
        const ensenNmEl = document.getElementById(slot.ensenNm);
        if (ensenNmEl) { ensenNmEl.value = ensen; }
        const ekiEl = document.getElementById(slot.eki);
        if (ekiEl) { ekiEl.value = eki; fire(ekiEl); out.push(`駅=${eki}`); }
        const ekiNmEl = document.getElementById(slot.ekiNm);
        if (ekiNmEl) { ekiNmEl.value = eki; }
        const radioEl = document.getElementById(slot.radio);
        if (radioEl) { radioEl.checked = true; fire(radioEl); out.push("徒歩=checked"); }
        const funEl = document.getElementById(slot.fun);
        if (funEl && walk !== "0") { funEl.value = walk; fire(funEl); out.push(`分数=${walk}`); }
        return out;
      }, { slot, ensen, eki, walk });

      if (result.length > 0) {
        filled.push(`交通${i + 1}: ${eki}駅 徒歩${walk}分`);
        console.log(`[forrent] transport(fallback) ${i + 1}: ${result.join(", ")}`);
      }
    } catch (e) {
      errors.push(`交通${i + 1}: ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`[forrent] transport(fallback): ${filled.length} filled, ${errors.length} errors`);
  return { filled, errors };
}

// 旧ポップアップ版（互換性のため残す）
async function fillTransportRakuraku(mainFrame, transportArray) {
  return fillTransportDirect(mainFrame, transportArray);
}

// ══════════════════════════════════════════════════════════
//  テキスト入力
// ══════════════════════════════════════════════════════════

async function fillTexts(mainFrame, catchCopy, freeComment, reinsData) {
  const errors = [];

  // テキストを制限内にtruncate（フリーコメント=100文字、キャッチ=30文字）
  const truncCatch = (catchCopy || "").slice(0, 30);
  const truncComment = (freeComment || "").slice(0, 100);

  // REINS備考情報から特記事項テキストを構築
  const biko = reinsData ? (reinsData.備考3 || reinsData.条件フリー || "") : "";
  const truncBiko = biko.slice(0, 200);

  // evaluate() で直接 DOM 操作（フレーム状態に左右されにくい）
  try {
    const result = await mainFrame.evaluate(({ catchCopy, freeComment, biko }) => {
      const out = [];
      const fields = [
        { id: "bukkenCatch", val: catchCopy },
        { id: "netCatch", val: catchCopy },
        { id: "netFreeMemo", val: freeComment },
        { id: "freeMemo", val: freeComment },
      ];
      // 特記事項 — REINS備考があれば設定
      if (biko) {
        fields.push({ id: "tokkiJiko", val: biko });
        fields.push({ id: "tokkiEtcMemo", val: biko });
      }
      for (const f of fields) {
        const el = document.getElementById(f.id);
        if (el) {
          el.value = f.val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          out.push(f.id);
        } else {
          out.push(`!${f.id}`);
        }
      }
      return out;
    }, { catchCopy: truncCatch, freeComment: truncComment, biko: truncBiko });

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
const MADORI_CATS = ["間取り図"];
const SHUHEN_CATS = ["周辺環境"];

// REINS categoryLabel → forrent.jp カテゴリコード
// 名寄せスコア配点: 居室・リビング=5pt, キッチン=5pt, バス・シャワールーム=5pt, その他=各1pt
const FORRENT_CATEGORY_MAP = {
  "居室・リビング": "040101",
  "キッチン": "040103",
  "バス・シャワー": "040104",
  "洋室": "040102",       // その他部屋・スペース
  "和室": "040102",
  "トイレ": "040105",
  "洗面所": "040106",
  "収納": "040107",
  "バルコニー": "040108",
  "玄関": "040110",
  "外観": "020101",
  "共用部": "030101",
  "エントランス": "030101",
  "間取り図": "999999",
  "眺望": "050101",
};

/**
 * 画像カテゴリselectを設定
 * @param {string} slotName - gaikanFile, shitsunaiFile, shashin1File, tsuikaGazo1File, etc.
 * @param {string} catCode - forrent.jpカテゴリコード (e.g. "040101")
 * @param {number} shashinIdx - 現在のshashin番号 (1-3) - shashinFile時のみ使用
 * @param {number} tsuikaIdx - 現在のtsuikaGazo番号 (1-8) - tsuikaGazoFile時のみ使用
 */
async function setImageCategory(frame, slotName, catCode, shashinIdx, tsuikaIdx) {
  await frame.evaluate(({ slot, code, sIdx, tIdx }) => {
    let sel = null;

    if (slot === "shitsunaiFile") {
      // 室内写真: shitsunaiShashinCategory or shitsunaiCategory
      sel = document.getElementById("shitsunaiShashinCategory")
        || document.getElementById("shitsunaiCategory")
        || document.querySelector("select[name*='shitsunaiCategory']");
    } else if (slot.startsWith("shashin") && slot.endsWith("File")) {
      // shashin1File → shashin1Category, shashin2File → shashin2Category ...
      const n = slot.replace("shashin", "").replace("File", "");
      sel = document.getElementById(`shashin${n}Category`);
    } else if (slot.startsWith("tsuikaGazo") && slot.endsWith("File")) {
      // tsuikaGazo1File → index 0 の categoryCd
      const n = parseInt(slot.replace("tsuikaGazo", "").replace("File", ""), 10);
      const idx = n - 1; // 1-based → 0-based
      const all = document.querySelectorAll("select[name*='tsuikaGazoInputForm'][name*='categoryCd']");
      if (idx < all.length) sel = all[idx];
    }
    // gaikanFile, shuhenKankyoFile → カテゴリselectなし（固定）

    if (sel) {
      sel.value = code;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, { slot: slotName, code: catCode, sIdx: shashinIdx, tIdx: tsuikaIdx });
}

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
  let gaikanDone = false, shitsunaiDone = false, madoriDone = false;
  let shashinN = 1;  // 1-3
  let tsuikaN = 1;   // 1-8
  let shuhenN = 1;   // 1-6

  for (const img of items) {
    const cat = img.categoryLabel || "";
    let inputName = null;

    // カテゴリ → スロット割り当て
    if (MADORI_CATS.includes(cat) && !madoriDone) {
      // 間取り図専用スロット（名寄せ5pt — shashin枠の1ptより大幅UP）
      inputName = "clientMadoriFile"; madoriDone = true;
    } else if (GAIKAN_CATS.includes(cat) && !gaikanDone) {
      inputName = "gaikanFile"; gaikanDone = true;
    } else if (INTERIOR_CATS.includes(cat) && !shitsunaiDone) {
      inputName = "shitsunaiFile"; shitsunaiDone = true;
    } else if (SHUHEN_CATS.includes(cat) && shuhenN <= 6) {
      const currentShuhen = shuhenN;
      inputName = `shuhenKankyo${shuhenN++}File`;
      // 周辺環境メタデータ設定（カテゴリ + 施設名 + 距離）
      // mokuteki{N} (select): 060203=コンビニ, destination{N} (text), distance{N} (text: m)
      try {
        await mainFrame.evaluate(({ n }) => {
          const catEl = document.getElementById(`mokuteki${n}`);
          if (catEl) {
            catEl.value = "060203"; // コンビニ（デフォルト）
            catEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const nameEl = document.getElementById(`destination${n}`);
          if (nameEl) {
            nameEl.value = "周辺環境";
            nameEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const distEl = document.getElementById(`distance${n}`);
          if (distEl) {
            distEl.value = "100"; // 100m
            distEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }, { n: currentShuhen });
        console.log(`[forrent] + 周辺環境${currentShuhen}メタ: コンビニ/100m`);
      } catch (e) {
        console.log(`[forrent] x 周辺環境メタ: ${e.message.slice(0, 60)}`);
      }
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

        // ★ カテゴリselect設定（名寄せスコアの主要配点）
        const forrentCatCode = FORRENT_CATEGORY_MAP[cat] || "";
        if (forrentCatCode) {
          await setImageCategory(mainFrame, inputName, forrentCatCode, shashinN - 1, tsuikaN - 1);
          console.log(`[forrent] + category: ${inputName} → ${forrentCatCode} (${cat})`);
        }
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

  // ★ 残りtsuikaGazoスロットを未使用カテゴリで埋める（その他画像 max 9pt）
  // 既存画像を再利用して名寄せスコアの「カテゴリ充填」を最大化
  const EXTRA_CATEGORIES = [
    { code: "040107", label: "収納" },
    { code: "040108", label: "バルコニー" },
    { code: "030101", label: "エントランス" },
    { code: "040111", label: "セキュリティ" },
    { code: "050101", label: "眺望" },
  ];
  // 使用済みカテゴリを集計
  const usedCodes = new Set();
  for (const img of items) {
    const cat = img.categoryLabel || "";
    const code = FORRENT_CATEGORY_MAP[cat];
    if (code) usedCodes.add(code);
  }
  // 室内写真から再利用候補を取得（外観・間取り・周辺環境は除外）
  // ★ 重複画像はスコア計上されないため、異なるファイルをラウンドロビンで使用
  const reuseImages = items.filter(img => INTERIOR_CATS.includes(img.categoryLabel || ""));

  if (reuseImages.length > 0 && tsuikaN <= 8) {
    let reuseIdx = 0;
    for (const extra of EXTRA_CATEGORIES) {
      if (tsuikaN > 8) break;
      if (usedCodes.has(extra.code)) continue;

      const reuseImage = reuseImages[reuseIdx % reuseImages.length];
      reuseIdx++;
      const inputName = `tsuikaGazo${tsuikaN++}File`;
      try {
        const ok = await setFileInput(mainFrame, inputName, reuseImage.localPath);
        if (ok) {
          uploaded.push(reuseImage.localPath);
          console.log(`[forrent] + image(fill): ${inputName} <- ${reuseImage.localPath.split("/").pop()} as ${extra.label}`);
          await setImageCategory(mainFrame, inputName, extra.code, 0, tsuikaN - 1);
          console.log(`[forrent] + category: ${inputName} → ${extra.code} (${extra.label})`);
        }
        await mainFrame.waitForTimeout(1000);
      } catch (e) {
        console.log(`[forrent] x fill: ${inputName}: ${e.message.slice(0, 60)}`);
      }
    }
  }

  console.log(`[forrent] images: ${uploaded.length} uploaded, ${errors.length} errors`);
  return { uploaded, errors };
}

// ══════════════════════════════════════════════════════════
//  特徴項目チェックボックス
// ══════════════════════════════════════════════════════════

// REINS設備フリーテキスト → forrent.jp categoryTokuchoCd value マッピング
const SETSUBI_TO_TOKUCHO = {
  // 設備フリーのキーワード → チェックボックスvalue(複数可)
  "防犯カメラ":         ["1211"],
  "オートロック":       ["1201"],
  "ガスコンロ":         ["1412"],
  "ガスコンロ（３口以上）": ["1415"],
  "3口以上":            ["1415"],
  "ＩＨ":               ["1416"],
  "IH":                 ["1416"],
  "追い焚き":           ["1505"],
  "追焚":               ["1505"],
  "エアコン":           ["2801"],
  "バルコニー":         ["2001"],
  "ベランダ":           ["2001"],
  "角部屋":             ["1007"],
  "カウンターキッチン": ["1403"],
  "対面式キッチン":     ["1403"],
  "シューズボックス":   ["2207"],
  "フローリング":       ["2101"],
  "室内洗濯":           ["2129"],
  "洗濯機置場":         ["2129"],
  "バストイレ別":       ["1501"],
  "温水洗浄便座":       ["1603"],
  "ウォシュレット":     ["1603"],
  "浴室乾燥機":         ["1507"],
  "浴室乾燥":           ["1507"],
  "独立洗面":           ["1701"],
  "洗面所独立":         ["1701"],
  "洗面化粧台":         ["1707"],
  "三面鏡":             ["1708"],
  "宅配ボックス":       ["0517"],
  "エレベーター":       ["0501"],
  "エレベータ":         ["0501"],
  "都市ガス":           ["1436"],
  "プロパン":           ["1437"],
  "光ファイバー":       ["2410"],
  "インターネット":     ["2408"],
  "ネット":             ["2408"],
  "BS":                 ["2401"],
  "CS":                 ["2401"],
  "CATV":               ["2404"],
  "床暖房":             ["1806"],
  "食器洗":             ["1430"],
  "食洗":               ["1430"],
  "ディスポーザー":     ["1434"],
  "24時間ゴミ":         ["0516"],
  "ペット":             ["2705"],
  "楽器":               ["2711"],
  "デザイナーズ":       ["0233"],
  "分譲賃貸":           ["0256"],
  "タワー":             ["0231"],
  "ロフト":             ["1326"],
  "システムキッチン":   ["1401"],
  "クロゼット":         ["2201"],
  "ウォークインクロゼット": ["2204"],
  "WIC":                ["2204"],
  "TVインターホン":     ["2414"],
  "モニター付きインターホン": ["2414"],
  "TVモニタ":           ["2414"],
  "セキュリティ":       ["1218"],
  "24時間換気":         ["1801"],
  "複層ガラス":         ["2122"],
  "ペアガラス":         ["2122"],
  "保証会社":           ["2725"],
};

// 建物属性から推定できる特徴項目
function inferTokuchoFromBuilding(reinsData) {
  const codes = new Set();
  const n = (s) => norm(s);

  // 階数からエレベーター推定（4階以上 → ほぼ確実）
  const floors = parseInt(n(reinsData.地上階層 || ""), 10);
  if (floors >= 4) codes.add("0501"); // エレベーター

  // 交通情報から駅数・沿線数
  const transport = reinsData.交通 || [];
  if (transport.length >= 2) codes.add("0102"); // 2駅利用可
  if (transport.length >= 3) codes.add("0104"); // 3駅以上利用可
  // 沿線の重複を除いてカウント
  const lines = new Set(transport.map(t => t.沿線).filter(Boolean));
  if (lines.size >= 2) codes.add("0103"); // 2沿線利用可
  if (lines.size >= 3) codes.add("0105"); // 3沿線以上利用可

  // 徒歩分数
  const walk = transport.map(t => parseInt(n(t.徒歩 || ""), 10)).filter(n => !isNaN(n));
  if (walk.some(w => w <= 5)) codes.add("0129"); // 駅徒歩5分以内
  if (walk.some(w => w <= 10)) codes.add("0130"); // 駅徒歩10分以内

  // バルコニー方向
  const dir = n(reinsData.バルコニー方向 || "");
  if (dir.includes("南東") || dir.includes("東南")) { codes.add("1002"); codes.add("2005"); } // 東南向き, 南面バルコニー
  else if (dir.includes("南西") || dir.includes("西南")) { codes.add("1003"); codes.add("2005"); }
  else if (dir === "南") { codes.add("1001"); codes.add("2005"); }

  // 角部屋（設備フリーでもチェックするが念のため）
  if (dir.includes("角")) codes.add("1007");

  // 条件フリーから
  const cond = n(reinsData.条件フリー || "");
  if (cond.includes("保証人不要")) codes.add("2724");
  if (cond.includes("保証会社")) codes.add("2725");

  return codes;
}

/**
 * 特徴項目チェックボックスを設定
 * @param {Frame} mainFrame
 * @param {object} reinsData - REINS抽出データ
 */
async function fillTokucho(mainFrame, reinsData) {
  console.log("[forrent] === TOKUCHO (特徴項目) START ===");

  // 1. 設備フリーテキストからマッチング
  const setsubiFree = norm(reinsData.設備フリー || "");
  const codesToCheck = new Set();

  for (const [keyword, codes] of Object.entries(SETSUBI_TO_TOKUCHO)) {
    if (setsubiFree.includes(norm(keyword))) {
      for (const c of codes) codesToCheck.add(c);
    }
  }

  // 2. 建物属性から推定
  const inferred = inferTokuchoFromBuilding(reinsData);
  for (const c of inferred) codesToCheck.add(c);

  if (codesToCheck.size === 0) {
    console.log("[forrent] tokucho: no matching features found");
    return { checked: 0, codes: [] };
  }

  // 3. チェックボックスを設定
  const codesArray = [...codesToCheck];
  const result = await mainFrame.evaluate((codes) => {
    let checked = 0;
    const checkedCodes = [];
    for (const code of codes) {
      // categoryTokuchoCd のチェックボックスで value=code のものを探す
      const cb = document.querySelector(
        `input[type="checkbox"][name="\${bukkenInputForm.categoryTokuchoCd}"][value="${code}"]`
      );
      if (cb && !cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        checked++;
        // ラベル取得
        let label = "";
        if (cb.nextSibling) label = (cb.nextSibling.textContent || "").trim().slice(0, 30);
        checkedCodes.push({ code, label });
      }
    }
    return { checked, checkedCodes };
  }, codesArray);

  for (const { code, label } of result.checkedCodes) {
    console.log(`[forrent] + 特徴: ${code} (${label})`);
  }
  console.log(`[forrent] === TOKUCHO END === checked: ${result.checked}`);

  return { checked: result.checked, codes: codesArray };
}

/**
 * らくらく周辺環境入力 — 物件の緯度経度から周辺施設を自動取得
 * ポップアップが開き、施設一覧からチェックボックスで選択→登録
 * @param {Page} page - Playwright page (ポップアップ検出用)
 * @param {Frame} mainFrame - forrent.jp main frame
 */
async function fillShuhenKankyo(page, mainFrame) {
  console.log("[forrent] === SHUHEN KANKYO (周辺環境) START ===");
  const filled = [];
  const errors = [];

  try {
    // 「らくらく周辺環境入力」ボタンをクリック
    const popupPromise = page.context().waitForEvent("page", { timeout: 15000 }).catch(() => null);
    const btnClicked = await mainFrame.evaluate(() => {
      const buttons = document.querySelectorAll("input[type='button']");
      for (const btn of buttons) {
        if (btn.value.includes("らくらく周辺環境")) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (!btnClicked) {
      console.log("[forrent] 周辺環境: らくらく周辺環境入力ボタンなし");
      return { filled, errors: ["らくらく周辺環境入力ボタンが見つかりません"] };
    }

    const popup = await popupPromise;
    if (!popup) {
      console.log("[forrent] 周辺環境: ポップアップが開きませんでした");
      return { filled, errors: ["周辺環境ポップアップが開きません"] };
    }

    console.log(`[forrent] 周辺環境ポップアップ検出: ${popup.url()}`);
    await popup.waitForLoadState("networkidle").catch(() => {});
    await popup.waitForTimeout(3000);

    // ポップアップ内の施設一覧を確認
    const facilityInfo = await popup.evaluate(() => {
      const result = {
        checkboxes: 0,
        checkedCount: 0,
        facilities: [],
        buttons: [],
      };

      // チェックボックスを検出
      const cbs = document.querySelectorAll("input[type='checkbox']");
      result.checkboxes = cbs.length;
      for (const cb of cbs) {
        if (cb.checked) result.checkedCount++;
        const tr = cb.closest("tr");
        const text = tr ? tr.textContent.trim().replace(/\s+/g, " ").slice(0, 100) : "";
        result.facilities.push({ checked: cb.checked, text, name: cb.name || "", value: cb.value || "" });
      }

      // ボタンを検出
      const buttons = document.querySelectorAll("input[type='button'], input[type='submit'], button, img[onclick]");
      for (const btn of buttons) {
        const text = (btn.value || btn.textContent || btn.alt || "").trim();
        if (text) result.buttons.push(text);
      }

      return result;
    }).catch(() => ({ checkboxes: 0, checkedCount: 0, facilities: [], buttons: [] }));

    console.log(`[forrent] 周辺環境ポップアップ: ${facilityInfo.checkboxes}件チェックボックス, ${facilityInfo.checkedCount}件チェック済み`);
    console.log(`[forrent] ボタン: ${facilityInfo.buttons.join(", ")}`);
    for (const f of facilityInfo.facilities.slice(0, 10)) {
      console.log(`[forrent]   [${f.checked ? "☑" : "☐"}] ${f.text.slice(0, 80)}`);
    }

    // チェックボックスがある場合: 最大6件を選択
    if (facilityInfo.checkboxes > 0 && facilityInfo.checkedCount === 0) {
      // 未チェックなら最初の6件をチェック
      await popup.evaluate(() => {
        const cbs = [...document.querySelectorAll("input[type='checkbox']")].slice(0, 6);
        for (const cb of cbs) {
          if (!cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
      console.log("[forrent] 周辺環境: 最初の6件を自動選択");
    }

    // 「登録」/「確定」/「反映」ボタンをクリック
    await popup.waitForTimeout(1000);
    const registClicked = await popup.evaluate(() => {
      // 登録ボタンを探す（ID、value、alt属性で検索）
      const btn = document.getElementById("registButton")
        || document.getElementById("regist")
        || document.getElementById("okButton");
      if (btn) { btn.click(); return btn.value || btn.alt || "registButton"; }

      // value で検索
      const buttons = [...document.querySelectorAll("input[type='button'], input[type='submit'], button")];
      for (const b of buttons) {
        const val = (b.value || b.textContent || "").trim();
        if (val.includes("登録") || val.includes("確定") || val.includes("反映") || val.includes("OK")) {
          b.click();
          return val;
        }
      }

      // img ボタンで検索
      const imgs = [...document.querySelectorAll("img")];
      for (const img of imgs) {
        const src = img.src || "";
        const alt = img.alt || "";
        if (src.includes("toroku") || alt.includes("登録") || src.includes("ok") || src.includes("regist")) {
          img.click();
          return alt || src;
        }
      }

      return null;
    }).catch((e) => {
      if (e.message.includes("closed") || e.message.includes("detach")) return "popup closed";
      return null;
    });

    console.log(`[forrent] 周辺環境ポップアップ: 登録=${registClicked}`);
    await mainFrame.waitForTimeout(3000);
    if (!popup.isClosed()) await popup.close().catch(() => {});

    // mainFrameの周辺環境フィールドが設定されたか確認
    await mainFrame.waitForTimeout(1000);
    const shuhenResult = await mainFrame.evaluate(() => {
      const out = [];
      for (let i = 0; i < 6; i++) {
        const nameEl = document.querySelector(`input[name="bukkenInputForm.shuhenKankyoInputForm[${i}].shuhenKankyoNm"]`);
        const kyoriEl = document.querySelector(`input[name="bukkenInputForm.shuhenKankyoInputForm[${i}].kyori"]`);
        const catEl = document.querySelector(`select[name="bukkenInputForm.shuhenKankyoInputForm[${i}].categoryCd"]`);
        const name = nameEl?.value || "";
        const kyori = kyoriEl?.value || "";
        const cat = catEl?.options[catEl.selectedIndex]?.text?.trim() || "";
        const catCd = catEl?.value || "";
        if (name || kyori) out.push({ name, kyori, cat, catCd });
      }
      return out;
    });

    for (const s of shuhenResult) {
      filled.push(`${s.name} / ${s.kyori}m / ${s.cat}`);
      console.log(`[forrent] + 周辺: ${s.name} / ${s.kyori}m / ${s.cat} (${s.catCd})`);
    }

    if (filled.length === 0) {
      console.log("[forrent] 周辺環境: フィールドが更新されませんでした");
      errors.push("周辺環境フィールドが更新されませんでした");
    }

  } catch (e) {
    console.log(`[forrent] 周辺環境エラー: ${e.message.slice(0, 100)}`);
    errors.push(`周辺環境エラー: ${e.message.slice(0, 60)}`);
  }

  console.log(`[forrent] === SHUHEN KANKYO END === filled: ${filled.length}`);
  return { filled, errors };
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
  fillTransportViaMap,
  fillTransportDirect,
  fillTransportRakuraku,
  fillTexts,
  uploadImages,
  fillTokucho,
  fillShuhenKankyo,
};
