/**
 * forrent.jp 千代田区 cascade select データ取得
 *
 * 東京都→千代田区を選択し、町村リストと各町村の字丁リストをダンプ。
 * 結果を ~/Desktop/suumo-nyuko/chiyoda-cascade.json に保存。
 *
 * Usage: bun run scripts/capture-cascade.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { chromium } = require("playwright");

async function main() {
  const outputDir = path.join(os.homedir(), "Desktop", "suumo-nyuko");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    // Login
    console.log("Logging in to forrent.jp...");
    await page.goto("https://www.fn.forrent.jp/fn/", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.waitForTimeout(3000);

    await page.fill('input[type="text"]', process.env.SUUMO_LOGIN_ID);
    await page.waitForTimeout(300);
    await page.fill('input[type="password"]', process.env.SUUMO_LOGIN_PASS);
    await page.waitForTimeout(300);
    await page.click('input[type="image"]');
    await page.waitForTimeout(8000);

    console.log("Logged in. URL:", page.url());

    // Navigate to new property registration
    const naviFrame = page.frame({ name: "navi" });
    if (!naviFrame) {
      console.error("Navi frame not found!");
      return;
    }

    await naviFrame.click("#menu_2"); // 物件登録
    await page.waitForTimeout(5000);

    const mainFrame = page.frame({ name: "main" });
    if (!mainFrame) {
      console.error("Main frame not found!");
      return;
    }

    console.log("On registration form. Starting cascade capture...");

    // Step 1: 東京都 is already selected (value=13, default)
    // Verify it
    const todofuken = await mainFrame.evaluate(() => {
      const sel = document.getElementById("todofukenList");
      return sel ? { value: sel.value, text: sel.options[sel.selectedIndex]?.text } : null;
    });
    console.log(`都道府県: ${JSON.stringify(todofuken)}`);

    // If not Tokyo, select it
    if (todofuken?.value !== "13") {
      await mainFrame.selectOption("#todofukenList", "13");
      await mainFrame.waitForTimeout(3000);
    }

    // Step 2: Wait for shigunkuList to populate
    await mainFrame.waitForFunction(
      () => document.getElementById("shigunkuList")?.options?.length > 1,
      { timeout: 10000 }
    );

    // Capture shigunku data for reference
    const shigunkuData = await mainFrame.evaluate(() => {
      const sel = document.getElementById("shigunkuList");
      return Array.from(sel.options).map((o) => ({ value: o.value, text: o.text.trim() }));
    });
    console.log(`市郡区: ${shigunkuData.length} options`);

    // Step 3: Select 千代田区 (value=101)
    console.log("Selecting 千代田区...");
    await mainFrame.selectOption("#shigunkuList", "101");
    await mainFrame.waitForTimeout(3000);

    // Wait for chosonList to populate
    await mainFrame.waitForFunction(
      () => document.getElementById("chosonList")?.options?.length > 1,
      { timeout: 10000 }
    );

    // Capture 町村 data
    const chosonData = await mainFrame.evaluate(() => {
      const sel = document.getElementById("chosonList");
      return Array.from(sel.options).map((o) => ({ value: o.value, text: o.text.trim() }));
    });
    console.log(`町村: ${chosonData.length} options`);
    for (const c of chosonData) {
      if (c.value) console.log(`  ${c.value}: ${c.text}`);
    }

    // Step 4: For each 町村, select it and capture 字丁 data
    const azaByChoson = {};
    const validChoson = chosonData.filter((c) => c.value !== "");

    for (let i = 0; i < validChoson.length; i++) {
      const choson = validChoson[i];
      console.log(`\n[${i + 1}/${validChoson.length}] ${choson.text} (${choson.value})...`);

      await mainFrame.selectOption("#chosonList", choson.value);
      await mainFrame.waitForTimeout(2000);

      // Wait for azaList to populate
      try {
        await mainFrame.waitForFunction(
          () => document.getElementById("azaList")?.options?.length > 1,
          { timeout: 8000 }
        );

        const azaData = await mainFrame.evaluate(() => {
          const sel = document.getElementById("azaList");
          return Array.from(sel.options).map((o) => ({ value: o.value, text: o.text.trim() }));
        });

        azaByChoson[choson.text] = {
          chosonCode: choson.value,
          aza: azaData.filter((a) => a.value !== ""),
        };
        console.log(`  → 字丁: ${azaData.filter((a) => a.value !== "").length} options`);
        for (const a of azaData) {
          if (a.value) console.log(`    ${a.value}: ${a.text}`);
        }
      } catch {
        // Some 町村 may not have 字丁
        azaByChoson[choson.text] = {
          chosonCode: choson.value,
          aza: [],
        };
        console.log(`  → 字丁: なし（タイムアウト）`);
      }
    }

    // Save result
    const result = {
      capturedAt: new Date().toISOString(),
      todofuken: { value: "13", text: "東京都" },
      shigunku: { value: "101", text: "千代田区" },
      choson: chosonData.filter((c) => c.value !== ""),
      azaByChoson,
    };

    const outputPath = path.join(outputDir, "chiyoda-cascade.json");
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nSaved to: ${outputPath}`);
    console.log(`町村数: ${validChoson.length}`);
    console.log(
      `字丁総数: ${Object.values(azaByChoson).reduce((sum, v) => sum + v.aza.length, 0)}`
    );
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

main();
