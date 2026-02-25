/**
 * forrent.jp 高スコア物件 vs 低スコア物件の差分調査
 * 41pt物件の修正フォームをダンプし、37pt物件と比較
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { chromium } = require("playwright");
const forrent = require("../skills/forrent");

const outDir = path.join(os.homedir(), "Desktop", "suumo-nyuko", "research");

// ダンプ対象: 41pt物件（ラフィネお茶の水408号室）
const TARGET_HIGH = "100478427976";
// 比較用: 自社テスト物件（SYFORME JIMBOCHO）
const TARGET_OWN = "100138002120";

async function dumpEditForm(page, mainFrame, bukkenCd, label) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`=== ${label} (${bukkenCd}) の修正フォームをダンプ ===`);
  console.log(`${"=".repeat(60)}`);

  // dispChangeShousai で物件詳細へ遷移
  await mainFrame.evaluate((cd) => {
    // dispChangeShousai が定義されていれば使う
    if (typeof dispChangeShousai === "function") {
      dispChangeShousai("UPD1R3100.action", cd, "0", Date.now().toString(), 0);
    } else {
      // フォールバック: 直接フォーム送信
      const form = document.querySelector("form");
      if (form) {
        form.action = "UPD1R3100.action";
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "bukkenCd";
        input.value = cd;
        form.appendChild(input);
        form.submit();
      }
    }
  }, bukkenCd);
  await page.waitForTimeout(6000);

  mainFrame = page.frame({ name: "main" });

  // 詳細ページの内容確認
  const pageInfo = await mainFrame.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    h1: document.querySelector("h1, .LV1_title")?.textContent?.trim() || "",
    bodySnippet: document.body?.innerText?.slice(0, 2000) || "",
  }));
  console.log(`  URL: ${pageInfo.url}`);
  console.log(`  Title: ${pageInfo.title}`);
  console.log(`  H1: ${pageInfo.h1}`);

  // 修正ボタンを探してクリック
  const hasEditBtn = await mainFrame.evaluate(() => {
    const allEls = [...document.querySelectorAll("a, img, input, button")];
    for (const el of allEls) {
      const text = (el.textContent || el.alt || el.value || "").trim();
      const onclick = el.getAttribute("onclick") || "";
      if (text.includes("修正") || onclick.includes("UPD1R3200")) {
        el.click();
        return text || onclick;
      }
    }
    return null;
  });

  if (hasEditBtn) {
    console.log(`  修正ボタンクリック: ${hasEditBtn}`);
    await page.waitForTimeout(8000);
    mainFrame = page.frame({ name: "main" });
  } else {
    // もしかしたら既に修正画面かも
    console.log("  修正ボタンなし（既に修正画面の可能性）");
  }

  // === フォームフィールドをダンプ ===
  const formFields = await mainFrame.evaluate(() => {
    const fields = [];
    // input (hidden含む — 名寄せスコアに影響する隠しフィールドもある可能性)
    for (const el of document.querySelectorAll("input")) {
      let val = "";
      if (el.type === "checkbox" || el.type === "radio") {
        val = el.checked ? "CHECKED" : "";
      } else {
        val = (el.value || "").slice(0, 200);
      }
      if (!val && el.type === "hidden") continue; // 空hidden は除外
      // ラベル
      let label = "";
      const tr = el.closest("tr");
      if (tr) {
        const th = tr.querySelector("th");
        if (th) label = th.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
      }
      fields.push({ tag: "input", type: el.type, name: el.name, value: val, label });
    }
    // select
    for (const el of document.querySelectorAll("select")) {
      const opt = el.options[el.selectedIndex];
      let label = "";
      const tr = el.closest("tr");
      if (tr) {
        const th = tr.querySelector("th");
        if (th) label = th.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
      }
      fields.push({
        tag: "select",
        name: el.name,
        value: opt ? `${opt.value} (${opt.text.trim().slice(0, 60)})` : "",
        label,
      });
    }
    // textarea
    for (const el of document.querySelectorAll("textarea")) {
      let label = "";
      const tr = el.closest("tr");
      if (tr) {
        const th = tr.querySelector("th");
        if (th) label = th.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
      }
      fields.push({ tag: "textarea", name: el.name, value: (el.value || "").slice(0, 500), label });
    }
    return fields;
  });

  // 入力済みフィールド
  const filledFields = formFields.filter(f => f.value && f.value !== "" && f.value !== "0");
  console.log(`\n--- 入力済みフィールド (${filledFields.length}/${formFields.length}件) ---`);
  for (const f of filledFields) {
    console.log(`  [${f.tag}:${f.type || ""}] ${f.name} = "${f.value}" (${f.label})`);
  }

  // 画像スロット状態
  const images = await mainFrame.evaluate(() => {
    const result = [];
    const fileInputs = document.querySelectorAll("input[type='file']");
    for (const fi of fileInputs) {
      const tr = fi.closest("tr");
      const imgs = tr ? [...tr.querySelectorAll("img")].filter(
        img => img.src && !img.src.includes("btn_") && !img.src.includes("icon_") && !img.src.includes("spacer") && img.naturalWidth > 30
      ) : [];
      const select = tr?.querySelector("select");
      const selectOpt = select?.options[select.selectedIndex];
      result.push({
        name: fi.name,
        hasImage: imgs.length > 0,
        imgSrc: imgs[0]?.src?.split("/").pop() || "",
        category: selectOpt ? `${selectOpt.value} (${selectOpt.text.trim()})` : "",
      });
    }
    return result;
  });

  console.log(`\n--- 画像スロット状態 (${images.length}件) ---`);
  for (const img of images) {
    console.log(`  [${img.hasImage ? "☑" : "☐"}] ${img.name} | cat: ${img.category} | img: ${img.imgSrc}`);
  }

  // 全select値（未入力含む）
  const allSelects = formFields.filter(f => f.tag === "select");
  console.log(`\n--- 全select値 (${allSelects.length}件) ---`);
  for (const s of allSelects) {
    console.log(`  ${s.name} = "${s.value}" (${s.label})`);
  }

  // 全textarea
  const allTextareas = formFields.filter(f => f.tag === "textarea");
  console.log(`\n--- 全textarea (${allTextareas.length}件) ---`);
  for (const t of allTextareas) {
    console.log(`  ${t.name} = "${t.value.slice(0, 100)}${t.value.length > 100 ? "..." : ""}" (${t.label})`);
  }

  // チェック済み特徴項目
  const checkedTokucho = await mainFrame.evaluate(() => {
    const result = [];
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    for (const cb of cbs) {
      if (cb.checked) {
        const label = cb.closest("label")?.textContent?.trim()
          || cb.nextSibling?.textContent?.trim()
          || "";
        result.push({ name: cb.name, value: cb.value, label: label.slice(0, 40) });
      }
    }
    return result;
  });

  console.log(`\n--- チェック済みチェックボックス (${checkedTokucho.length}件) ---`);
  for (const t of checkedTokucho) {
    console.log(`  ☑ ${t.name} = ${t.value} (${t.label})`);
  }

  // スクリーンショット保存
  const ssPath = path.join(outDir, `edit-form-${bukkenCd}.png`);
  await page.screenshot({ path: ssPath, fullPage: false });
  console.log(`\n  スクリーンショット: ${ssPath}`);

  // JSON保存
  const jsonPath = path.join(outDir, `edit-form-${bukkenCd}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ formFields, images, checkedTokucho, pageInfo }, null, 2));
  console.log(`  JSON保存: ${jsonPath}`);

  return { formFields, images, checkedTokucho };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const ok = await forrent.login(page, {
    id: process.env.SUUMO_LOGIN_ID,
    pass: process.env.SUUMO_LOGIN_PASS,
  });
  if (!ok) { console.error("ログイン失敗"); process.exit(1); }
  page.on("dialog", async (d) => { await d.accept(); });

  // 物件検索ページへ
  console.log("=== 物件検索ページへ ===");
  const naviFrame = page.frame({ name: "navi" });
  await naviFrame.click("#menu_3");
  await page.waitForTimeout(5000);

  let mainFrame = page.frame({ name: "main" });

  // 検索（全物件 — フィルタなし）
  console.log("=== 全物件検索 ===");
  await mainFrame.evaluate(() => {
    const form = document.querySelector("form[name='searchForm']") || document.querySelector("form");
    if (form) form.submit();
  });
  await page.waitForTimeout(8000);
  mainFrame = page.frame({ name: "main" });

  // 41pt物件の詳細/修正フォームをダンプ
  const highData = await dumpEditForm(page, mainFrame, TARGET_HIGH, "41pt物件（ラフィネお茶の水408号室）");

  // 検索結果に戻る
  console.log("\n=== 検索結果に戻る ===");
  const naviFrame2 = page.frame({ name: "navi" });
  await naviFrame2.click("#menu_3");
  await page.waitForTimeout(5000);
  mainFrame = page.frame({ name: "main" });

  // 再検索
  await mainFrame.evaluate(() => {
    const form = document.querySelector("form[name='searchForm']") || document.querySelector("form");
    if (form) form.submit();
  });
  await page.waitForTimeout(8000);
  mainFrame = page.frame({ name: "main" });

  // 37pt物件（自社テスト物件）の詳細/修正フォームをダンプ
  const ownData = await dumpEditForm(page, mainFrame, TARGET_OWN, "37pt物件（SYFORME JIMBOCHO）");

  // === 差分比較 ===
  console.log("\n" + "=".repeat(60));
  console.log("=== 差分分析 ===");
  console.log("=".repeat(60));

  // フィールド名で比較（入力済みフィールド）
  const highFilledNames = new Set(highData.formFields.filter(f => f.value).map(f => f.name));
  const ownFilledNames = new Set(ownData.formFields.filter(f => f.value).map(f => f.name));

  const onlyInHigh = [...highFilledNames].filter(n => !ownFilledNames.has(n));
  const onlyInOwn = [...ownFilledNames].filter(n => !highFilledNames.has(n));

  console.log(`\n--- 41pt物件のみにあるフィールド (${onlyInHigh.length}件) ---`);
  for (const name of onlyInHigh) {
    const f = highData.formFields.find(f => f.name === name);
    console.log(`  + ${name} = "${(f?.value || "").slice(0, 80)}" (${f?.label || ""})`);
  }

  console.log(`\n--- 37pt物件のみにあるフィールド (${onlyInOwn.length}件) ---`);
  for (const name of onlyInOwn) {
    const f = ownData.formFields.find(f => f.name === name);
    console.log(`  - ${name} = "${(f?.value || "").slice(0, 80)}" (${f?.label || ""})`);
  }

  // 画像スロット比較
  console.log(`\n--- 画像スロット比較 ---`);
  console.log(`  41pt: ${highData.images.filter(i => i.hasImage).length}/${highData.images.length} スロット使用中`);
  console.log(`  37pt: ${ownData.images.filter(i => i.hasImage).length}/${ownData.images.length} スロット使用中`);

  const highCats = highData.images.filter(i => i.hasImage).map(i => i.category);
  const ownCats = ownData.images.filter(i => i.hasImage).map(i => i.category);
  console.log(`  41pt カテゴリ: ${highCats.join(", ")}`);
  console.log(`  37pt カテゴリ: ${ownCats.join(", ")}`);

  // textarea比較
  console.log(`\n--- テキスト入力比較 ---`);
  const highTexts = highData.formFields.filter(f => f.tag === "textarea" && f.value);
  const ownTexts = ownData.formFields.filter(f => f.tag === "textarea" && f.value);
  console.log(`  41pt textarea入力数: ${highTexts.length}`);
  console.log(`  37pt textarea入力数: ${ownTexts.length}`);
  for (const ht of highTexts) {
    const ownMatch = ownTexts.find(o => o.name === ht.name);
    console.log(`  ${ht.name}: 41pt="${ht.value.slice(0, 50)}..." / 37pt="${ownMatch?.value?.slice(0, 50) || "(なし)"}..."`);
  }

  // 差分分析結果をJSON保存
  fs.writeFileSync(path.join(outDir, "score-diff.json"), JSON.stringify({
    onlyInHigh: onlyInHigh.map(n => {
      const f = highData.formFields.find(f => f.name === n);
      return { name: n, value: f?.value, label: f?.label };
    }),
    onlyInOwn: onlyInOwn.map(n => {
      const f = ownData.formFields.find(f => f.name === n);
      return { name: n, value: f?.value, label: f?.label };
    }),
    highImages: highData.images,
    ownImages: ownData.images,
  }, null, 2));
  console.log(`\n  差分JSON: ${path.join(outDir, "score-diff.json")}`);

  console.log("\n  ブラウザは開いたままです。Ctrl+C で終了。");
  await new Promise(() => {});
}

main().catch(console.error);
