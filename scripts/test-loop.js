/**
 * テスト→スコア確認→修正ループ用スクリプト
 *
 * 初回: REINS抽出 + AI画像処理 → キャッシュ保存
 * 2回目以降: キャッシュから読み込み → forrent.jpフォーム入力のみ再実行
 *
 * Usage:
 *   bun run scripts/test-loop.js <REINS物件番号>
 *   bun run scripts/test-loop.js 100138002120
 *   bun run scripts/test-loop.js 100138002120 --fresh   # キャッシュ無視して全工程再実行
 */

const path = require("path");
const os = require("os");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { chromium } = require("playwright");
const reins = require("../skills/reins");
const forrent = require("../skills/forrent");
const { analyzeAndCropImages } = require("../skills/image-ai");
const { generateTexts } = require("../skills/text-ai");
const { captureMapScreenshot } = require("../skills/google-maps");

const reinsId = process.argv[2];
const fresh = process.argv.includes("--fresh");

if (!reinsId) {
  console.error("Usage: bun run scripts/test-loop.js <REINS物件番号>");
  process.exit(1);
}

const downloadDir = path.join(os.homedir(), "Desktop", "suumo-nyuko", reinsId);
const cacheFile = path.join(downloadDir, "test-cache.json");

async function main() {
  fs.mkdirSync(downloadDir, { recursive: true });

  let cache = null;
  if (!fresh && fs.existsSync(cacheFile)) {
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    console.log("=== キャッシュ読み込み ===");
    console.log(`  物件名: ${cache.reinsData.建物名}`);
    console.log(`  画像数: ${cache.processedImages.length}`);
    console.log(`  テキスト: "${cache.texts.catchCopy?.slice(0, 20)}..."`);
    console.log("");
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  try {
    // ══ Phase 1: REINS データ取得（キャッシュなければ実行） ══
    let reinsData, processedImages, texts;

    if (cache) {
      reinsData = cache.reinsData;
      processedImages = cache.processedImages;
      texts = cache.texts;
    } else {
      const reinsPage = await context.newPage();

      console.log("=== REINS ログイン ===");
      const reinsOk = await reins.login(reinsPage, {
        id: process.env.REINS_LOGIN_ID,
        pass: process.env.REINS_LOGIN_PASS,
      });
      if (!reinsOk) { console.error("REINS ログイン失敗"); return; }

      console.log("=== REINS データ抽出 ===");
      const found = await reins.searchByNumber(reinsPage, reinsId);
      if (!found) { console.error(`物件 ${reinsId} 見つからず`); return; }
      reinsData = await reins.extractPropertyData(reinsPage);
      console.log("  物件名:", reinsData.建物名);
      console.log("  所在地:", [reinsData.都道府県名, reinsData.所在地名１, reinsData.所在地名２, reinsData.所在地名３].join(""));
      console.log("  賃料:", reinsData.賃料, "共益費:", reinsData.共益費);
      console.log("  間取り:", reinsData.間取部屋数, reinsData.間取タイプ, "面積:", reinsData.使用部分面積);
      console.log("  交通:", JSON.stringify(reinsData.交通));
      console.log("  入居時期:", reinsData.入居時期, "取引態様:", reinsData.取引態様);

      console.log("\n=== 画像スクリーンショット ===");
      const imagesMeta = await reins.extractImageData(reinsPage);
      const downloaded = await reins.screenshotAllImages(reinsPage, imagesMeta.length, downloadDir);
      console.log(`  ${downloaded.length}枚スクリーンショット完了`);

      console.log("\n=== AI 画像処理 ===");
      processedImages = await analyzeAndCropImages(downloaded, downloadDir);
      console.log(`  ${processedImages.length}枚カテゴリ画像生成`);

      // Google Maps
      console.log("\n=== Google Maps 周辺環境 ===");
      const mapsPage = await context.newPage();
      const address = [reinsData.都道府県名, reinsData.所在地名１, reinsData.所在地名２, reinsData.所在地名３].filter(Boolean).join("");
      const mapImage = await captureMapScreenshot(mapsPage, address, path.join(downloadDir, "processed"));
      if (mapImage) processedImages.push(mapImage);
      await mapsPage.close();

      console.log("\n=== AI テキスト生成 ===");
      texts = await generateTexts(reinsData);
      console.log(`  キャッチ: "${texts.catchCopy}"`);

      // キャッシュ保存
      const cacheData = { reinsData, processedImages, texts, cachedAt: new Date().toISOString() };
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
      console.log("\n=== キャッシュ保存完了 ===\n");

      await reinsPage.close();
    }

    // ══ Phase 2: forrent.jp フォーム入力（毎回実行） ══
    const forrentPage = await context.newPage();

    console.log("=== forrent.jp ログイン ===");
    const forrentOk = await forrent.login(forrentPage, {
      id: process.env.SUUMO_LOGIN_ID,
      pass: process.env.SUUMO_LOGIN_PASS,
    });
    if (!forrentOk) { console.error("forrent.jp ログイン失敗"); return; }

    console.log("=== 新規物件登録フォーム ===");
    const { mainFrame } = await forrent.navigateToNewProperty(forrentPage);

    console.log("\n=== フォーム入力開始 ===");
    const { filled, errors: formErrors } = await forrent.fillPropertyForm(mainFrame, reinsData);

    console.log("\n=== テキスト入力 ===");
    const textErrors = await forrent.fillTexts(mainFrame, texts.catchCopy, texts.freeComment);

    console.log("\n=== 画像アップロード ===");
    const { uploaded, errors: uploadErrors } = await forrent.uploadImages(mainFrame, processedImages);

    console.log("\n=== 交通入力 ===");
    const transportResult = await forrent.fillTransportDirect(mainFrame, reinsData.交通);

    // ══ 結果レポート ══
    const allErrors = [...formErrors, ...transportResult.errors, ...textErrors, ...uploadErrors];

    console.log("\n" + "═".repeat(60));
    console.log("  テスト結果");
    console.log("═".repeat(60));
    console.log(`  成功フィールド: ${Object.keys(filled).length}`);
    console.log(`    ${Object.keys(filled).join(", ")}`);
    console.log(`  アップロード画像: ${uploaded.length}/${processedImages.length}`);
    console.log(`  交通: ${transportResult.filled.join(", ") || "なし"}`);
    if (allErrors.length > 0) {
      console.log(`  エラー(${allErrors.length}件):`);
      for (const e of allErrors) console.log(`    ✗ ${e}`);
    }
    console.log("═".repeat(60));

    // スクリーンショット保存
    const ssPath = path.join(downloadDir, `test-result-${Date.now()}.png`);
    await mainFrame.evaluate(() => window.scrollTo(0, 0));
    await forrentPage.screenshot({ path: ssPath, fullPage: false });
    console.log(`  スクリーンショット: ${ssPath}`);

    // ブラウザは閉じない（手動確認用）
    console.log("\n  ブラウザは開いたままです。Ctrl+C で終了。");
    await new Promise(() => {}); // hang

  } catch (err) {
    console.error("Error:", err);
  }
}

main();
