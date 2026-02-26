/**
 * Image Pipeline — Claude Vision 個別分類 + Sharp リサイズ
 *
 * 各画像を1枚ずつClaude Visionで分類し、正確なカテゴリを割り当てる。
 * 使用済みカテゴリは候補から除外し、重複を防ぐ。
 */

const Anthropic = require("@anthropic-ai/sdk");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const client = new Anthropic();

const SUUMO_CATEGORIES = [
  { id: "01", label: "居室・リビング", score: 5 },
  { id: "02", label: "キッチン", score: 5 },
  { id: "03", label: "バス・シャワー", score: 5 },
  { id: "04", label: "間取り図", score: 5 },
  { id: "05", label: "外観", score: 5 },
  { id: "06", label: "洋室", score: 1 },
  { id: "07", label: "和室", score: 1 },
  { id: "08", label: "トイレ", score: 1 },
  { id: "09", label: "洗面所", score: 1 },
  { id: "10", label: "玄関", score: 1 },
  { id: "11", label: "収納", score: 1 },
  { id: "12", label: "バルコニー", score: 1 },
  { id: "13", label: "共用部", score: 1 },
  { id: "14", label: "周辺環境", score: 1 },
];

/**
 * 1枚の画像をClaude Visionで分類
 * @param {Buffer} imageBuffer - JPEG画像バッファ
 * @param {Array<{id: string, label: string}>} availableCategories - 使用可能なカテゴリ
 * @returns {string|null} カテゴリID
 */
async function classifySingleImage(imageBuffer, availableCategories) {
  const catList = availableCategories.map((c) => `${c.id}=${c.label}`).join(", ");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 50,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `この不動産写真を1つのカテゴリに分類してください。
カテゴリ: ${catList}
ただし、QRコードの画像の場合は「QR」とだけ回答してください。
IDのみ回答（例: 01）。間取り図・平面図は必ず04。建物外観は05。QRコードはQR。`,
          },
        ],
      },
    ],
  });

  const text = response.content[0].text.trim();
  // QRコード検出（修正点14）
  if (/QR/i.test(text)) {
    return "QR";
  }
  // IDを抽出（2桁の数字）
  const match = text.match(/\b(\d{2})\b/);
  if (match && availableCategories.find((c) => c.id === match[1])) {
    return match[1];
  }
  return null;
}

/**
 * 画像を個別にClaude Visionで分類し、Sharp でリサイズ
 *
 * @param {Array<{index: number, localPath: string}>} downloaded
 * @param {string} downloadDir
 * @returns {Array<{localPath: string, categoryId: string, categoryLabel: string}>}
 */
async function analyzeAndCropImages(downloaded, downloadDir, existingCategories = []) {
  const outputDir = path.join(downloadDir, "processed");
  fs.mkdirSync(outputDir, { recursive: true });

  const validImages = downloaded.filter((img) => fs.existsSync(img.localPath));
  if (validImages.length === 0) return [];

  const processedImages = [];
  const usedCategories = new Set(existingCategories);

  // 5ptカテゴリを優先的に埋めるため、まず全画像を分類してからソート
  const classifications = [];

  for (const img of validImages) {
    const buffer = fs.readFileSync(img.localPath);
    const available = SUUMO_CATEGORIES.filter((c) => !usedCategories.has(c.id));

    let catId = null;
    try {
      catId = await classifySingleImage(buffer, available);
    } catch (err) {
      console.error(`[image] Vision failed #${img.index}:`, err.message);
    }

    // フォールバック: 5ptカテゴリを優先的に埋める
    if (!catId) {
      const fallback = available.find((c) => c.score === 5) || available[0];
      catId = fallback?.id;
    }

    // QRコード画像はスキップ（修正点14）
    if (catId === "QR") {
      console.log(`[image] #${img.index} → QRコード検出 → スキップ`);
      continue;
    }

    if (catId) {
      usedCategories.add(catId);
      classifications.push({ img, catId });
      const cat = SUUMO_CATEGORIES.find((c) => c.id === catId);
      console.log(`[image] #${img.index} → ${cat?.label} (vision)`);
    }
  }

  // リサイズして出力
  for (const { img, catId } of classifications) {
    const cat = SUUMO_CATEGORIES.find((c) => c.id === catId);
    const outPath = path.join(outputDir, `cat_${catId}_${img.index}.jpg`);

    try {
      await sharp(img.localPath)
        .resize({ width: 1280, height: 960, fit: "cover", position: "centre" })
        .jpeg({ quality: 85 })
        .toFile(outPath);

      processedImages.push({
        localPath: outPath,
        categoryId: catId,
        categoryLabel: cat?.label || catId,
        sourceIndex: img.index,
      });
    } catch (err) {
      console.error(`[image] resize failed #${img.index}:`, err.message);
    }
  }

  // Sort: 5-point categories first
  return processedImages.sort((a, b) => {
    const scoreA = SUUMO_CATEGORIES.find((c) => c.id === a.categoryId)?.score || 0;
    const scoreB = SUUMO_CATEGORIES.find((c) => c.id === b.categoryId)?.score || 0;
    return scoreB - scoreA;
  });
}

module.exports = { analyzeAndCropImages, SUUMO_CATEGORIES };
