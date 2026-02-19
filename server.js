const path = require("path");
const os = require("os");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env.local") });

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const next = require("next");
const { chromium } = require("playwright");

const reins = require("./skills/reins");
const forrent = require("./skills/forrent");
const { analyzeAndCropImages } = require("./skills/image-ai");
const { generateTexts } = require("./skills/text-ai");
const { captureMapScreenshot } = require("./skills/google-maps");
// score-checker は情報入力完了後の手動確認フェーズで使用（自動実行しない）
// const { readNayoseScore, navigateToScorePage } = require("./skills/score-checker");

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ══════════════════════════════════════════════════════════
//  ORCHESTRATOR: runNyuko — SUUMO listing pipeline (multi-page)
// ══════════════════════════════════════════════════════════
async function runNyuko(socket, reinsId) {
  const emit = (stepIndex, status, detail = "") =>
    socket.emit("step-update", { stepIndex, status, detail });
  const done = (payload) => socket.emit("done", payload);
  const fail = (msg) => socket.emit("error", { message: msg });

  // Desktop保存（永続化）
  const downloadDir = path.join(os.homedir(), "Desktop", "suumo-nyuko", reinsId);
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  let browser;

  // 7-minute global timeout
  const globalTimeout = setTimeout(() => {
    fail("タイムアウト（7分）- 自動化を中断しました");
    if (browser) browser.close().catch(() => {});
  }, 7 * 60 * 1000);

  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });

    // マルチページ: REINS用 + forrent.jp用
    const reinsPage = await context.newPage();
    const forrentPage = await context.newPage();

    // ── Step 0: REINS ログイン ──
    emit(0, "running", "system.reins.jpにログイン中...");
    const reinsLoginOk = await reins.login(reinsPage, {
      id: process.env.REINS_LOGIN_ID,
      pass: process.env.REINS_LOGIN_PASS,
    });
    if (!reinsLoginOk) {
      fail("REINSログインに失敗しました。ID/パスワードを確認してください。");
      return;
    }
    emit(0, "done", "ログイン成功");

    // ── Step 1: データ抽出 ──
    emit(1, "running", `物件番号 ${reinsId} を検索中...`);
    const found = await reins.searchByNumber(reinsPage, reinsId);
    if (!found) {
      fail(`物件番号 ${reinsId} が見つかりませんでした。番号を確認してください。`);
      return;
    }
    const reinsData = await reins.extractPropertyData(reinsPage);
    emit(1, "done", reinsData.建物名 || reinsId);

    // ── Step 2: 画像スクリーンショット ──
    emit(2, "running", "画像セクションに移動中...");
    const imagesMeta = await reins.extractImageData(reinsPage);
    emit(2, "running", `${imagesMeta.length}枚の画像をスクリーンショット中...`);
    const downloaded = await reins.screenshotAllImages(reinsPage, imagesMeta.length, downloadDir);
    emit(2, "done", `${downloaded.length}枚スクリーンショット完了 → ~/Desktop/suumo-nyuko/${reinsId}/`);

    // ── Step 3: AI画像処理 ──
    emit(3, "running", "画像を分析・カテゴリ分類中...");
    const processedImages = await analyzeAndCropImages(downloaded, downloadDir);
    emit(3, "done", `${processedImages.length}枚のカテゴリ画像を生成`);

    // ── Step 3.5: Google Maps 周辺環境 ──
    emit(3, "running", "Google Mapsで周辺環境を撮影中...");
    const address = [
      reinsData.都道府県名,
      reinsData.所在地名１,
      reinsData.所在地名２,
      reinsData.所在地名３,
    ].filter(Boolean).join("");

    if (address) {
      const mapImage = await captureMapScreenshot(forrentPage, address, path.join(downloadDir, "processed"));
      if (mapImage) {
        processedImages.push(mapImage);
        emit(3, "done", `${processedImages.length}枚（周辺環境含む）`);
      }
    }

    // ── Step 4: AIテキスト生成 ──
    emit(4, "running", "キャッチコピーとコメントを生成中...");
    const texts = await generateTexts(reinsData);
    emit(4, "done", `"${texts.catchCopy}"`);

    // ── Step 5: forrent.jp 入稿 ──
    emit(5, "running", "fn.forrent.jpにログイン中...");
    const forrentLoginOk = await forrent.login(forrentPage, {
      id: process.env.SUUMO_LOGIN_ID,
      pass: process.env.SUUMO_LOGIN_PASS,
    });
    if (!forrentLoginOk) {
      fail("forrent.jpログインに失敗しました。");
      return;
    }

    emit(5, "running", "新規物件登録フォームに移動中...");
    const { mainFrame } = await forrent.navigateToNewProperty(forrentPage);

    emit(5, "running", "フォームフィールドを入力中...");
    const { filled, errors: formErrors } = await forrent.fillPropertyForm(
      mainFrame,
      reinsData
    );

    // キャッチコピー・コメント（交通より前に実行 — 交通がフレーム離脱を起こす可能性があるため）
    emit(5, "running", "キャッチコピー・コメントを入力中...");
    const textErrors = await forrent.fillTexts(
      mainFrame,
      texts.catchCopy,
      texts.freeComment
    );

    // 画像アップロード
    emit(5, "running", `${processedImages.length}枚の画像をアップロード中...`);
    const { uploaded, errors: uploadErrors } = await forrent.uploadImages(
      mainFrame,
      processedImages
    );

    // 交通入力（最後に実行 — DOM直接操作で安全に）
    emit(5, "running", "交通情報を入力中...");
    const transportResult = await forrent.fillTransportDirect(mainFrame, reinsData.交通);

    const allErrors = [
      ...formErrors,
      ...transportResult.errors,
      ...textErrors,
      ...uploadErrors,
    ];
    emit(5, "done", `入力${Object.keys(filled).length}件, 画像${uploaded.length}枚, 交通${transportResult.filled.length}件`);

    // ゴール: 情報入力完了。フォームは送信せず、ブラウザを開いたまま確認待ち。
    done({
      catchCopy: texts.catchCopy,
      comment: texts.freeComment,
      propertyName: reinsData.建物名 || reinsId,
      filledFields: Object.keys(filled).length,
      uploadedImages: uploaded.length,
      transport: transportResult.filled,
      errors: allErrors,
      savedTo: downloadDir,
    });
  } catch (err) {
    console.error("[runNyuko] Error:", err);
    fail(`予期しないエラー: ${err.message}`);
  } finally {
    clearTimeout(globalTimeout);
    // ブラウザは閉じない（ユーザーが確認できるように）
    // 手動で閉じるまで開いたまま
    // if (browser) await browser.close().catch(() => {});

    // Desktop保存なので /tmp のクリーンアップは不要
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

  // ── Socket.io ──
  io.on("connection", (socket) => {
    socket.on("start-nyuko", async (data) => {
      const reinsId = data.reinsId?.trim();
      if (!reinsId) {
        socket.emit("error", { message: "物件番号が入力されていません" });
        return;
      }
      await runNyuko(socket, reinsId);
    });
  });

  // ── Next.js handler (catch-all) ──
  app.all("*", (req, res) => handle(req, res));

  const PORT = process.env.PORT || 3456;
  server.listen(PORT, () => {
    console.log(`\n  SUUMO Auto-Nyuko ready -> http://localhost:${PORT}\n`);
  });
});
