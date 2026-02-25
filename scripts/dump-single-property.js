/**
 * 単一物件の修正フォームをダンプするスクリプト
 * Usage: bun run scripts/dump-single-property.js <bukkenCd> [label]
 * Example: bun run scripts/dump-single-property.js 100470003510 "37pt岩見沢"
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { chromium } = require("playwright");
const forrent = require("../skills/forrent");

const bukkenCd = process.argv[2];
const label = process.argv[3] || bukkenCd;

if (!bukkenCd) {
  console.error("Usage: bun run scripts/dump-single-property.js <bukkenCd> [label]");
  process.exit(1);
}

const outDir = path.join(os.homedir(), "Desktop", "suumo-nyuko", "research");

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const creds = {
    id: process.env.SUUMO_LOGIN_ID,
    pass: process.env.SUUMO_LOGIN_PASS,
  };
  console.log(`  認証: id=${creds.id ? creds.id.slice(0, 4) + "..." : "MISSING"}, pass=${creds.pass ? "***" : "MISSING"}`);
  const ok = await forrent.login(page, creds);
  console.log(`  ログイン結果: ${ok}, URL: ${page.url()}`);
  if (!ok) {
    // デバッグ: スクリーンショット + ページ内容
    await page.screenshot({ path: path.join(outDir, "login-debug.png") });
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "");
    console.error("ログイン失敗");
    console.error("ページ内容:", bodyText);
    console.log("スクリーンショット:", path.join(outDir, "login-debug.png"));
    // ブラウザ開いたまま
    console.log("ブラウザは開いたままです。手動確認後Ctrl+Cで終了。");
    await new Promise(() => {});
  }
  page.on("dialog", async (d) => { await d.accept(); });

  // 物件検索ページへ
  console.log("=== 物件検索ページへ ===");
  const naviFrame = page.frame({ name: "navi" });
  await naviFrame.click("#menu_3");
  await page.waitForTimeout(5000);

  let mainFrame = page.frame({ name: "main" });

  // 全物件検索
  console.log("=== 全物件検索 ===");
  await mainFrame.evaluate(() => {
    const form = document.querySelector("form[name='searchForm']") || document.querySelector("form");
    if (form) form.submit();
  });
  await page.waitForTimeout(8000);
  mainFrame = page.frame({ name: "main" });

  // 物件詳細へ遷移
  console.log(`\n=== ${label} (${bukkenCd}) の修正フォームをダンプ ===`);
  await mainFrame.evaluate((cd) => {
    if (typeof dispChangeShousai === "function") {
      dispChangeShousai("UPD1R3100.action", cd, "0", Date.now().toString(), 0);
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
  console.log(`  H1: ${pageInfo.h1}`);

  if (pageInfo.h1.includes("エラー") || pageInfo.bodySnippet.includes("エラー")) {
    console.error("  ページエラー:", pageInfo.bodySnippet.slice(0, 200));
    process.exit(1);
  }

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
    console.log("  修正ボタンなし（既に修正画面の可能性）");
  }

  // === フォームフィールドをダンプ ===
  const formFields = await mainFrame.evaluate(() => {
    const fields = [];
    for (const el of document.querySelectorAll("input")) {
      let val = "";
      if (el.type === "checkbox" || el.type === "radio") {
        val = el.checked ? "CHECKED" : "";
      } else {
        val = (el.value || "").slice(0, 200);
      }
      if (!val && el.type === "hidden") continue;
      let label = "";
      const tr = el.closest("tr");
      if (tr) {
        const th = tr.querySelector("th");
        if (th) label = th.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
      }
      fields.push({ tag: "input", type: el.type, name: el.name, value: val, label });
    }
    for (const el of document.querySelectorAll("select")) {
      const opt = el.options[el.selectedIndex];
      let label = "";
      const tr = el.closest("tr");
      if (tr) {
        const th = tr.querySelector("th");
        if (th) label = th.textContent.trim().replace(/\s+/g, " ").slice(0, 60);
      }
      fields.push({
        tag: "select", name: el.name,
        value: opt ? `${opt.value} (${opt.text.trim().slice(0, 60)})` : "",
        label,
      });
    }
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
        name: fi.name, hasImage: imgs.length > 0,
        imgSrc: imgs[0]?.src?.split("/").pop() || "",
        category: selectOpt ? `${selectOpt.value} (${selectOpt.text.trim()})` : "",
      });
    }
    return result;
  });

  console.log(`\n--- 画像スロット (${images.length}件) ---`);
  for (const img of images) {
    console.log(`  [${img.hasImage ? "☑" : "☐"}] ${img.name} | cat: ${img.category} | img: ${img.imgSrc}`);
  }

  // チェック済みチェックボックス
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

  // 選択済みradio
  const radios = formFields.filter(f => f.type === "radio" && f.value === "CHECKED");
  console.log(`\n--- 選択済みradio (${radios.length}件) ---`);
  for (const r of radios) {
    // ラジオの値も取得
    const radioVal = await mainFrame.evaluate((name) => {
      const checked = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
      return checked ? checked.value : "";
    }, r.name);
    console.log(`  ${r.name} = ${radioVal} (${r.label})`);
  }

  // スクリーンショット保存
  const ssPath = path.join(outDir, `edit-form-${bukkenCd}.png`);
  await page.screenshot({ path: ssPath, fullPage: false });

  // JSON保存
  const jsonPath = path.join(outDir, `edit-form-${bukkenCd}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ formFields, images, checkedTokucho, pageInfo }, null, 2));
  console.log(`\n  JSON: ${jsonPath}`);
  console.log(`  PNG: ${ssPath}`);

  console.log("\n  ブラウザは開いたままです。Ctrl+C で終了。");
  await new Promise(() => {});
}

main().catch(console.error);
