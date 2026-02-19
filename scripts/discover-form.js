/**
 * forrent.jp フォーム構造ダンプスクリプト
 *
 * 新規物件登録フォームにアクセスし、全フィールドの構造を取得。
 * 結果を ~/Desktop/suumo-nyuko/form-structure.json に保存。
 *
 * Usage: bun run scripts/discover-form.js
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

    console.log("On registration form. Discovering fields...");

    // Screenshot the full form
    await mainFrame.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(outputDir, "form-screenshot-top.png"),
      fullPage: false,
    });

    // Deep form discovery
    const formData = await mainFrame.evaluate(() => {
      const result = {
        title: document.title,
        forms: [],
        sections: [],
        allFields: [],
      };

      // Get all forms
      const forms = document.querySelectorAll("form");
      for (const form of forms) {
        result.forms.push({
          name: form.name,
          id: form.id,
          action: form.action,
          method: form.method,
        });
      }

      // Get all table sections (forrent.jp uses tables for layout)
      const tables = document.querySelectorAll("table");
      for (let ti = 0; ti < tables.length; ti++) {
        const table = tables[ti];
        const rows = table.querySelectorAll("tr");
        const sectionRows = [];

        for (const row of rows) {
          const th = row.querySelector("th");
          const td = row.querySelector("td");
          if (!th && !td) continue;

          const rowData = {
            headerText: th?.textContent?.replace(/[\n\r\t]/g, " ").replace(/\s+/g, " ").trim() || "",
            fields: [],
          };

          // Find all inputs/selects/textareas in this row's td
          const cells = td ? [td] : [row];
          for (const cell of cells) {
            const elements = cell.querySelectorAll("input, select, textarea");
            for (const el of elements) {
              const type = el.type || "";
              if (["hidden", "submit", "image", "button"].includes(type)) continue;

              const fieldInfo = {
                tagName: el.tagName.toLowerCase(),
                type,
                name: el.name || "",
                id: el.id || "",
                value: el.value || "",
                placeholder: el.placeholder || "",
                maxLength: el.maxLength > 0 ? el.maxLength : undefined,
                size: el.size > 0 ? el.size : undefined,
                className: el.className || "",
              };

              if (el.tagName === "SELECT") {
                fieldInfo.options = Array.from(el.options).map((o) => ({
                  value: o.value,
                  text: o.text.trim(),
                  selected: o.selected,
                }));
                fieldInfo.optionCount = el.options.length;
              }

              if (type === "checkbox" || type === "radio") {
                fieldInfo.checked = el.checked;
                // Get adjacent label text
                const nextSib = el.nextSibling;
                if (nextSib && nextSib.nodeType === 3) {
                  fieldInfo.adjacentText = nextSib.textContent.trim();
                }
                const nextEl = el.nextElementSibling;
                if (nextEl && (nextEl.tagName === "LABEL" || nextEl.tagName === "SPAN")) {
                  fieldInfo.adjacentText = nextEl.textContent.trim();
                }
              }

              rowData.fields.push(fieldInfo);
            }
          }

          if (rowData.headerText || rowData.fields.length > 0) {
            sectionRows.push(rowData);
          }
        }

        if (sectionRows.length > 0) {
          result.sections.push({
            tableIndex: ti,
            rows: sectionRows,
          });
        }
      }

      // Also get ALL form elements globally (including outside tables)
      const allElements = document.querySelectorAll("input, select, textarea");
      for (const el of allElements) {
        const type = el.type || "";
        if (["hidden", "submit", "image", "button"].includes(type)) continue;

        result.allFields.push({
          tagName: el.tagName.toLowerCase(),
          type,
          name: el.name || "",
          id: el.id || "",
          placeholder: el.placeholder || "",
          maxLength: el.maxLength > 0 ? el.maxLength : undefined,
        });
      }

      // Check for any links/buttons with "らくらく" text
      const links = document.querySelectorAll("a, button, input[type='button']");
      result.specialButtons = [];
      for (const link of links) {
        const text = link.textContent?.trim() || link.value || "";
        if (
          text.includes("らくらく") ||
          text.includes("交通") ||
          text.includes("画像") ||
          text.includes("キャッチ") ||
          text.includes("コメント") ||
          text.includes("確認")
        ) {
          result.specialButtons.push({
            tagName: link.tagName.toLowerCase(),
            text: text.slice(0, 100),
            id: link.id || "",
            name: link.name || "",
            href: link.href || "",
            onclick: link.getAttribute("onclick")?.slice(0, 200) || "",
          });
        }
      }

      return result;
    });

    // Save the full dump
    const outputPath = path.join(outputDir, "form-structure.json");
    fs.writeFileSync(outputPath, JSON.stringify(formData, null, 2));
    console.log(`\nForm structure saved to: ${outputPath}`);
    console.log(`Total fields: ${formData.allFields.length}`);
    console.log(`Sections: ${formData.sections.length}`);
    console.log(`Special buttons: ${formData.specialButtons.length}`);

    // Print summary
    console.log("\n=== FORM SECTIONS ===");
    for (const section of formData.sections) {
      console.log(`\n--- Table ${section.tableIndex} ---`);
      for (const row of section.rows) {
        if (row.headerText) {
          const fieldSummary = row.fields
            .map((f) => `[${f.tagName}:${f.type || f.tagName} name="${f.name}" id="${f.id}"]`)
            .join(" ");
          console.log(`  ${row.headerText}: ${fieldSummary || "(no fields)"}`);
        }
      }
    }

    console.log("\n=== SPECIAL BUTTONS ===");
    for (const btn of formData.specialButtons) {
      console.log(`  [${btn.tagName}] "${btn.text}" id="${btn.id}" onclick="${btn.onclick}"`);
    }

    // Scroll down and take more screenshots
    const pageHeight = await mainFrame.evaluate(() => document.body.scrollHeight);
    const viewportHeight = 900;
    let scrollPos = 0;
    let screenshotIndex = 1;

    while (scrollPos < pageHeight) {
      scrollPos += viewportHeight - 100;
      await mainFrame.evaluate((y) => window.scrollTo(0, y), scrollPos);
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(outputDir, `form-screenshot-${screenshotIndex++}.png`),
      });
    }

    console.log(`\n${screenshotIndex} screenshots saved to ${outputDir}`);
    console.log("\nKeeping browser open for manual inspection. Press Ctrl+C to exit.");

    // Keep browser open for 5 minutes for manual inspection
    await page.waitForTimeout(300000);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

main();
