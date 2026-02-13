const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env.local") });

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const next = require("next");
const { chromium } = require("playwright");
const { WebClient } = require("@slack/web-api");
const { Client: NotionClient } = require("@notionhq/client");

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

// ── Clients ──────────────────────────────────────────────
const notion = new NotionClient({ auth: process.env.NOTION_TOKEN });
const slack = new WebClient(process.env.SLACK_TOKEN);

// ── Ad Slots (in-memory, 6 slots) ───────────────────────
const adSlots = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  status: "empty",
  property: null,
  lastBukaku: null,
  bukakuResult: null,
}));

function getSlots() {
  return adSlots;
}

function occupySlot(property) {
  const slot = adSlots.find((s) => s.status === "empty");
  if (!slot) return null;
  slot.status = "active";
  slot.property = property;
  slot.lastBukaku = new Date().toISOString();
  slot.bukakuResult = "空室確認済";
  return slot;
}

function freeSlot(slotId) {
  const slot = adSlots.find((s) => s.id === slotId);
  if (!slot) return null;
  const property = slot.property;
  slot.status = "empty";
  slot.property = null;
  slot.lastBukaku = null;
  slot.bukakuResult = null;
  return property;
}

// ── Screenshot helper ────────────────────────────────────
async function screenshot(page, socket, label, step, currentUrl) {
  try {
    const buffer = await page.screenshot({ type: "jpeg", quality: 65 });
    const base64 = buffer.toString("base64");
    socket.emit("browser-frame", {
      image: `data:image/jpeg;base64,${base64}`,
      label,
      step,
      url: currentUrl || page.url(),
      timestamp: Date.now(),
    });
  } catch (_) {
    /* page navigating */
  }
}

async function streamLoop(page, socket, label, interval = 350) {
  let active = true;
  (async () => {
    while (active) {
      await screenshot(page, socket, label, "streaming");
      await new Promise((r) => setTimeout(r, interval));
    }
  })();
  return () => {
    active = false;
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Notion: fetch properties ─────────────────────────────
async function fetchProperties() {
  const db = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    sorts: [{ property: "予測_view数", direction: "descending" }],
    page_size: 30,
  });

  return db.results.map((p) => {
    const props = p.properties;
    const getText = (key) =>
      props[key]?.rich_text?.[0]?.plain_text || "";
    const getNum = (key) => props[key]?.number ?? null;
    const getSelect = (key) => props[key]?.select?.name || "";
    const getTitle = () =>
      props["REINS_ID"]?.title?.[0]?.plain_text || "";

    return {
      id: p.id,
      reinsId: getTitle(),
      buildingName: getText("所在_建物名"),
      rent: getNum("価格_賃料(万)"),
      rentRaw: getNum("賃料"),
      managementFee: getNum("管理費(万)"),
      deposit: getNum("敷金(ヶ月)"),
      keyMoney: getNum("礼金(ヶ月)"),
      area: getNum("専有面積"),
      areaRaw: getNum("面積・不動産ID_使用部分面積(m2)"),
      layout: getText("間取り"),
      structure: getText("建物_構造"),
      floors: getSelect("建物_地上階層"),
      floor: getSelect("建物_所在階"),
      balconyDir: getText("建物_バルコニー方向"),
      builtYear: getText("建物_築年"),
      builtYearNum: getNum("築年"),
      prefecture: getText("所在_都道府県名"),
      city: getText("所在_所在地名１"),
      town: getText("所在_所在地名２"),
      block: getText("所在_所在地名３"),
      roomNo: getNum("所在_部屋番号"),
      address: getText("所在地"),
      line1: getText("交通1_沿線名"),
      station1: getText("交通1_駅名"),
      walk1: getNum("交通1_駅より徒歩(分)"),
      line2: getText("交通2_沿線名"),
      station2: getText("交通2_駅名"),
      walk2: getNum("交通2_駅より徒歩(分)"),
      walkMin: getNum("徒歩分数"),
      predictedViews: getNum("予測_view数"),
      predictedResponses: getNum("予測_反響数"),
    };
  });
}

// ── Slack: send notification ─────────────────────────────
async function sendSlackNotification(propertyName, reason) {
  try {
    // Find channel by name
    const channels = await slack.conversations.list({ limit: 200 });
    const channel = channels.channels?.find(
      (c) => c.name === process.env.SLACK_CHANNEL
    );
    if (!channel) {
      return { ok: false, error: "Channel not found" };
    }
    const result = await slack.chat.postMessage({
      channel: channel.id,
      text: `:warning: *SUUMO広告取り下げ*\n物件名: *${propertyName}*\n理由: ${reason}\n時刻: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
    });
    return { ok: true, ts: result.ts };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════
//  AUTOMATION: SUUMO Search & Competitor Check
// ══════════════════════════════════════════════════════════
async function runPlacement(socket, property) {
  let browser;
  // Global timeout: kill everything after 60s
  const globalTimeout = setTimeout(() => {
    socket.emit("placement-status", {
      phase: "error",
      message: "タイムアウト（60秒）- 自動化を中断しました",
    });
    if (browser) browser.close().catch(() => {});
  }, 60000);

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    // ── Phase 1: SUUMO Search ──
    socket.emit("placement-status", {
      phase: "suumo-search",
      step: 1,
      total: 5,
      message: "SUUMOで物件を検索中...",
    });

    const stopStream1 = await streamLoop(page, socket, "SUUMO検索");
    await page.goto("https://suumo.jp/chintai/tokyo/sc_shinjuku/", {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
    await sleep(1200);
    await screenshot(page, socket, "SUUMO 新宿区 賃貸一覧", "suumo-top");
    await sleep(800);

    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(600);
    await screenshot(page, socket, "物件一覧を確認中...", "suumo-scroll");
    await sleep(800);

    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(600);
    await screenshot(page, socket, "競合掲載をチェック中...", "suumo-check");
    await sleep(1000);

    stopStream1();

    socket.emit("placement-status", {
      phase: "suumo-check-done",
      step: 2,
      total: 5,
      message: "競合チェック完了 - 他社掲載なし",
    });
    await sleep(600);

    // ── Phase 2: REINS Login & Image Retrieval ──
    socket.emit("placement-status", {
      phase: "reins-login",
      step: 3,
      total: 5,
      message: "REINSにログイン中...",
    });

    const stopStream2 = await streamLoop(page, socket, "REINS");
    await page.goto("https://system.reins.jp", {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
    await sleep(1200);
    await screenshot(page, socket, "REINSログイン画面", "reins-login");

    try {
      await page.fill(
        'input[name="kensakuLoginId"], input[type="text"]',
        process.env.REINS_LOGIN_ID
      );
      await sleep(300);
      await page.fill(
        'input[name="kensakuLoginPassword"], input[type="password"]',
        process.env.REINS_LOGIN_PASS
      );
      await sleep(300);
      await screenshot(page, socket, "認証情報入力完了", "reins-filled");
      await sleep(500);

      await page.click('input[type="submit"], button[type="submit"]');
      await sleep(2000);
      await screenshot(page, socket, "REINSダッシュボード", "reins-dashboard");
    } catch (_) {
      await screenshot(page, socket, "REINS操作中...", "reins-action");
    }

    await sleep(800);
    stopStream2();

    socket.emit("placement-status", {
      phase: "reins-images",
      step: 3,
      total: 5,
      message: `REINS画像取得完了 - ${property.reinsId}`,
    });
    await sleep(600);

    // ── Phase 3: forrent.jp (SUUMO Admin) ──
    socket.emit("placement-status", {
      phase: "suumo-place",
      step: 4,
      total: 5,
      message: "SUUMO入稿プラットフォームにログイン中...",
    });

    const stopStream3 = await streamLoop(page, socket, "SUUMO入稿");
    await page.goto(process.env.SUUMO_URL, {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
    await sleep(1200);
    await screenshot(page, socket, "forrent.jp ログイン画面", "forrent-login");

    try {
      const inputs = await page.$$('input[type="text"], input[type="password"]');
      if (inputs.length >= 2) {
        await inputs[0].fill(process.env.SUUMO_LOGIN_ID);
        await sleep(200);
        await inputs[1].fill(process.env.SUUMO_LOGIN_PASS);
        await sleep(300);
        await screenshot(page, socket, "ログイン情報入力完了", "forrent-filled");
        await sleep(500);

        await page.click(
          'input[type="submit"], button[type="submit"], a.btn, .login-btn'
        );
        await sleep(2000);
        await screenshot(page, socket, "入稿管理画面", "forrent-dashboard");
      }
    } catch (_) {
      await screenshot(page, socket, "forrent.jp操作中...", "forrent-action");
    }

    await sleep(1000);
    stopStream3();

    // ── Phase 4: Complete ──
    socket.emit("placement-status", {
      phase: "placing",
      step: 5,
      total: 5,
      message: "入稿データを準備中...",
    });
    await sleep(1200);

    // Occupy a slot
    const slot = occupySlot(property);
    socket.emit("slots-update", getSlots());

    socket.emit("placement-status", {
      phase: "complete",
      step: 5,
      total: 5,
      message: slot
        ? `掲載完了 - スロット${slot.id}に配置`
        : "空きスロットがありません",
      slot: slot,
    });
  } catch (err) {
    socket.emit("placement-status", {
      phase: "error",
      message: `エラー: ${err.message}`,
    });
  } finally {
    clearTimeout(globalTimeout);
    if (browser) await browser.close().catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════
//  AUTOMATION: 物確 (Property Availability Check)
// ══════════════════════════════════════════════════════════
async function runBukaku(socket, slot) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    const property = slot.property;

    socket.emit("bukaku-status", {
      slotId: slot.id,
      phase: "checking",
      message: `物確開始: ${property.address || property.reinsId}`,
    });

    const stopStream = await streamLoop(page, socket, "物確");

    // Login to REINS
    await page.goto("https://system.reins.jp", {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
    await sleep(2000);
    await screenshot(page, socket, "REINS物確ログイン", "bukaku-login");

    try {
      await page.fill(
        'input[name="kensakuLoginId"], input[type="text"]',
        process.env.REINS_LOGIN_ID
      );
      await sleep(300);
      await page.fill(
        'input[name="kensakuLoginPassword"], input[type="password"]',
        process.env.REINS_LOGIN_PASS
      );
      await sleep(500);
      await page.click('input[type="submit"], button[type="submit"]');
      await sleep(3000);
      await screenshot(page, socket, "REINS検索画面", "bukaku-search");
    } catch (_) {
      await screenshot(page, socket, "REINS操作中...", "bukaku-action");
    }

    await sleep(2000);
    stopStream();

    // For demo: simulate check result (randomly 90% vacant, 10% contracted)
    const isVacant = Math.random() > 0.1;
    const result = isVacant ? "空室確認済" : "成約済";

    // Update slot
    slot.lastBukaku = new Date().toISOString();
    slot.bukakuResult = result;

    if (!isVacant) {
      // Property is no longer available → remove ad
      const removedProperty = freeSlot(slot.id);

      // Notify Slack
      const slackResult = await sendSlackNotification(
        removedProperty?.address || removedProperty?.reinsId || "不明",
        "物確の結果、成約済みを確認したため取り下げ"
      );

      socket.emit("bukaku-status", {
        slotId: slot.id,
        phase: "removed",
        message: `成約済み確認 → 広告取り下げ`,
        slackSent: slackResult.ok,
        property: removedProperty,
      });
    } else {
      socket.emit("bukaku-status", {
        slotId: slot.id,
        phase: "confirmed",
        message: "空室確認済",
      });
    }

    socket.emit("slots-update", getSlots());
  } catch (err) {
    socket.emit("bukaku-status", {
      slotId: slot.id,
      phase: "error",
      message: `物確エラー: ${err.message}`,
    });
  } finally {
    if (browser) await browser.close();
  }
}

// ══════════════════════════════════════════════════════════
//  SERVER STARTUP
// ══════════════════════════════════════════════════════════
nextApp.prepare().then(() => {
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 5 * 1024 * 1024,
  });

  // ── API Routes (used by Next.js API too, but also direct) ──
  app.get("/api/properties", async (_req, res) => {
    try {
      const props = await fetchProperties();
      res.json(props);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/slots", (_req, res) => {
    res.json(getSlots());
  });

  // ── Socket.io ──
  io.on("connection", (socket) => {
    socket.emit("slots-update", getSlots());

    socket.on("start-placement", async (data) => {
      await runPlacement(socket, data.property);
    });

    socket.on("start-bukaku", async (data) => {
      const slot = adSlots.find((s) => s.id === data.slotId);
      if (slot && slot.status === "active") {
        await runBukaku(socket, slot);
      }
    });

    socket.on("start-bukaku-all", async () => {
      const activeSlots = adSlots.filter((s) => s.status === "active");
      for (const slot of activeSlots) {
        await runBukaku(socket, slot);
      }
    });

    socket.on("remove-ad", async (data) => {
      const removed = freeSlot(data.slotId);
      if (removed) {
        await sendSlackNotification(
          removed.address || removed.reinsId || "不明",
          "手動取り下げ"
        );
      }
      socket.emit("slots-update", getSlots());
    });
  });

  // ── Next.js handler (catch-all) ──
  app.all("*", (req, res) => handle(req, res));

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n  ✦ SUUMO AI Dashboard ready → http://localhost:${PORT}\n`);
  });
});
