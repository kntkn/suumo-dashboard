#!/usr/bin/env node
/**
 * REINS → Notion Data Sync
 *
 * Notionに新規追加された物件（賃料が空のもの）を検出し、
 * REINSから物件詳細を取得してNotionを更新する。
 *
 * Usage:
 *   node scripts/reins-to-notion.js            # 新規物件のみ処理
 *   node scripts/reins-to-notion.js --all       # 全件再処理
 *   node scripts/reins-to-notion.js --test      # 1件テスト
 *
 * 完了時にJSON形式で報告を stdout に出力する。
 */

const path = require("path");
const fs = require("fs");

// dotenv: .env.local があればロード（GitHub Actionsでは env secrets を使う）
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

const { chromium } = require("playwright");
const { Client: NotionClient } = require("@notionhq/client");
const reins = require("../skills/reins");

const notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const MAX_LOGIN_RETRIES = 3;
const MAX_PROPERTY_RETRIES = 2;

// ── Parse helpers ────────────────────────────────────────
function parseRent(str) {
  const m = str?.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseYen(str) {
  const m = str?.match(/([\d,]+)円/);
  if (!m) return null;
  return parseFloat((parseInt(m[1].replace(/,/g, "")) / 10000).toFixed(2));
}

function parseMonths(str) {
  if (!str || str.includes("なし") || str === "-") return 0;
  const m = str.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseArea(str) {
  const m = str?.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseFloor(str) {
  const m = str?.match(/(\d+)/);
  return m ? m[1] : null;
}

function parseYear(str) {
  const m = str?.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

function parseWalk(str) {
  const m = str?.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function normalizeHalfWidth(str) {
  if (!str) return str;
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
}

// ── Build Notion properties from REINS data ──────────────
function buildNotionProps(data) {
  const props = {};

  const setText = (key, value) => {
    if (value != null && value !== "") {
      props[key] = { rich_text: [{ text: { content: String(value) } }] };
    }
  };
  const setNum = (key, value) => {
    if (value != null && !isNaN(value)) {
      props[key] = { number: value };
    }
  };
  const setSelect = (key, value) => {
    if (value) {
      props[key] = { select: { name: String(value) } };
    }
  };

  const rent = parseRent(data.賃料);
  setNum("価格_賃料(万)", rent);
  setNum("賃料", rent);
  setNum("管理費(万)", parseYen(data.共益費));
  setNum("敷金(ヶ月)", parseMonths(data.敷金));
  setNum("礼金(ヶ月)", parseMonths(data.礼金));

  const area = parseArea(data.使用部分面積);
  setNum("専有面積", area);
  setNum("面積・不動産ID_使用部分面積(m2)", area);

  setText("所在_都道府県名", data.都道府県名);
  setText("所在_所在地名１", data.所在地名１);
  setText("所在_所在地名２", data.所在地名２);
  setText("所在_所在地名３", data.所在地名３);
  setText("所在_建物名", data.建物名);

  const fullAddress = [data.都道府県名, data.所在地名１, data.所在地名２, data.所在地名３]
    .filter(Boolean)
    .join("");
  setText("所在地", fullAddress);

  if (data.部屋番号) {
    const roomNo = parseInt(data.部屋番号);
    if (!isNaN(roomNo)) setNum("所在_部屋番号", roomNo);
  }

  if (data.間取タイプ) {
    const rooms = data.間取部屋数?.match(/(\d+)/)?.[1] || "";
    const type = normalizeHalfWidth(data.間取タイプ);
    setText("間取り", `${rooms}${type}`);
  }

  setText("建物_築年", data.築年月);
  setNum("築年", parseYear(data.築年月));
  setText("建物_構造", data.建物構造);

  const floorTotal = parseFloor(data.地上階層);
  if (floorTotal) setSelect("建物_地上階層", `${floorTotal}階`);
  const floorAt = parseFloor(data.所在階);
  if (floorAt) setSelect("建物_所在階", `${floorAt}階`);

  setText("建物_バルコニー方向", data.バルコニー方向);

  if (data.交通?.length > 0) {
    const t1 = data.交通[0];
    setText("交通1_沿線名", t1.沿線);
    setText("交通1_駅名", t1.駅);
    const walk1 = parseWalk(t1.徒歩);
    setNum("交通1_駅より徒歩(分)", walk1);
    setNum("徒歩分数", walk1);
  }
  if (data.交通?.length > 1) {
    const t2 = data.交通[1];
    setText("交通2_沿線名", t2.沿線);
    setText("交通2_駅名", t2.駅);
    setNum("交通2_駅より徒歩(分)", parseWalk(t2.徒歩));
  }

  return props;
}

// ── Report: stdout JSON + Slack Webhook ──────────────────
async function report(obj) {
  const json = JSON.stringify(obj);
  console.log(json);

  if (!SLACK_WEBHOOK_URL) {
    console.error("SLACK_WEBHOOK_URL未設定 - Slack通知スキップ");
    return;
  }

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: json }),
    });
    if (res.ok) {
      console.error("Slack通知送信完了");
    } else {
      console.error(`Slack通知失敗: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Slack通知失敗: ${err.message}`);
  }
}

// ── REINS Login with retry ───────────────────────────────
async function loginWithRetry(page) {
  for (let attempt = 1; attempt <= MAX_LOGIN_RETRIES; attempt++) {
    try {
      const ok = await reins.login(page, {
        id: process.env.REINS_LOGIN_ID,
        pass: process.env.REINS_LOGIN_PASS,
      });
      if (ok) return true;
      console.error(`Login attempt ${attempt}: redirected to wrong page`);
    } catch (err) {
      console.error(`Login attempt ${attempt}: ${err.message}`);
    }
    if (attempt < MAX_LOGIN_RETRIES) {
      await page.waitForTimeout(3000);
    }
  }
  return false;
}

// ── Process single property with retry ───────────────────
async function processProperty(page, reinsId) {
  for (let attempt = 1; attempt <= MAX_PROPERTY_RETRIES; attempt++) {
    try {
      await page.goto(reins.REINS_URLS.dashboard, {
        waitUntil: "networkidle",
        timeout: 20000,
      });
      await page.waitForTimeout(2000);

      const found = await reins.searchByNumber(page, reinsId);
      if (!found) return { status: "not_found" };

      const data = await reins.extractPropertyData(page);
      return { status: "ok", data };
    } catch (err) {
      console.error(`  Property ${reinsId} attempt ${attempt}: ${err.message}`);
      if (attempt < MAX_PROPERTY_RETRIES) {
        await page.waitForTimeout(2000);
      }
    }
  }
  return { status: "error", error: `${MAX_PROPERTY_RETRIES}回試行失敗` };
}

// ── Main ─────────────────────────────────────────────────
async function run(mode) {
  // 1. Fetch all Notion pages
  const db = await notion.databases.query({ database_id: DB_ID, page_size: 100 });
  const allPages = db.results.map((p) => ({
    pageId: p.id,
    reinsId: p.properties.REINS_ID?.title?.[0]?.plain_text || "",
    hasData: p.properties["賃料"]?.number != null,
  }));

  // 2. Filter: new properties only (unless --all)
  let targets;
  if (mode === "all") {
    targets = allPages;
  } else if (mode === "test") {
    targets = allPages.filter((p) => !p.hasData).slice(0, 1);
    if (targets.length === 0) targets = allPages.slice(0, 1);
  } else {
    targets = allPages.filter((p) => !p.hasData);
  }

  if (targets.length === 0) {
    await report({
      agent: "reins-sync",
      status: "success",
      synced: 0,
      total_in_db: allPages.length,
    });
    return;
  }

  console.error(`Processing ${targets.length} new properties (${allPages.length} total in DB)`);

  // 3. Launch browser & login
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const loginOk = await loginWithRetry(page);
  if (!loginOk) {
    await browser.close();
    await report({
      agent: "reins-sync",
      status: "error",
      error: "REINS_LOGIN_FAILED",
      attempts: MAX_LOGIN_RETRIES,
      last_url: page.url(),
    });
    process.exit(1);
  }

  // 4. Process each property
  const synced = [];
  const notFound = [];
  const errors = [];

  for (let i = 0; i < targets.length; i++) {
    const { pageId, reinsId } = targets[i];
    console.error(`[${i + 1}/${targets.length}] ${reinsId}`);

    const result = await processProperty(page, reinsId);

    if (result.status === "ok") {
      const notionProps = buildNotionProps(result.data);
      await notion.pages.update({ page_id: pageId, properties: notionProps });
      const building = result.data.建物名 || "";
      const rent = result.data.賃料 || "";
      console.error(`  -> ${building} / ${rent}`);
      synced.push({ reinsId, building, rent });
    } else if (result.status === "not_found") {
      console.error(`  -> not_found`);
      notFound.push(reinsId);
    } else {
      console.error(`  -> error: ${result.error}`);
      errors.push({ reinsId, error: result.error });
    }

    await page.waitForTimeout(1000);
  }

  await browser.close();

  // 5. Build report
  const r = {
    agent: "reins-sync",
    status: errors.length > 0 ? "error" : "success",
    synced: synced.length,
    not_found: notFound.length,
    errors: errors.length,
    total_in_db: allPages.length,
  };
  if (synced.length > 0) r.synced_properties = synced;
  if (notFound.length > 0) r.not_found_ids = notFound;
  if (errors.length > 0) r.error_details = errors;

  await report(r);
}

// Parse CLI args
const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : args.includes("--test") ? "test" : "new";

run(mode).catch(async (err) => {
  await report({
    agent: "reins-sync",
    status: "error",
    error: err.message,
    stack: err.stack?.split("\n").slice(0, 3).join(" | "),
  });
  process.exit(1);
});
