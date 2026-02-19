/**
 * AI Image Pipeline — Claude Vision + Sharp
 *
 * Analyzes REINS property photos, classifies them into SUUMO categories,
 * and generates cropped/resized variants to maximize 名寄せスコア.
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
 * Analyze REINS images with Claude Vision, classify into SUUMO categories,
 * and create cropped variants using sharp.
 *
 * @param {Array<{index: number, localPath: string}>} downloaded - Downloaded REINS images
 * @param {string} downloadDir - Base directory for image files
 * @returns {Array<{localPath: string, categoryId: string, categoryLabel: string}>}
 */
async function analyzeAndCropImages(downloaded, downloadDir) {
  const outputDir = path.join(downloadDir, "processed");
  fs.mkdirSync(outputDir, { recursive: true });

  // Read all images as base64
  const imageContents = downloaded
    .filter((img) => fs.existsSync(img.localPath))
    .map((img) => {
      const buffer = fs.readFileSync(img.localPath);
      return {
        index: img.index,
        localPath: img.localPath,
        base64: buffer.toString("base64"),
      };
    });

  if (imageContents.length === 0) return [];

  // Single Claude Vision call to classify all images
  const categoryList = SUUMO_CATEGORIES.map(
    (c) => `"${c.id}"=${c.label}(${c.score}pt)`
  ).join(", ");

  const analysisPrompt = `あなたは不動産写真の分類専門家です。
以下の${imageContents.length}枚の画像を分析してください。

■ SUUMOカテゴリ: ${categoryList}

各画像について以下をJSON配列で回答してください（説明不要、JSONのみ）:
- index: 画像番号
- primaryCategory: 最適なカテゴリID
- secondaryCategories: クロップで追加生成できるカテゴリIDの配列
- cropSuggestions: クロップ領域。{categoryId, x, y, width, height} を相対比率(0.0〜1.0)で指定
- quality: 画像品質 1〜5

重要ルール:
- 5点カテゴリ(01〜05)を優先的に割り当てる
- 間取り図(04)は図面・平面図のみに割り当てる
- 1枚の写真から別エリアをクロップして別カテゴリにできる場合はcropSuggestionsに含める
  例: リビング全体写真からキッチン部分をクロップ
- クロップは元画像の20%以上の面積を確保すること`;

  const messageContent = [{ type: "text", text: analysisPrompt }];
  for (const img of imageContents) {
    messageContent.push(
      { type: "text", text: `\n--- 画像 ${img.index} ---` },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: img.base64,
        },
      }
    );
  }

  let classifications;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: messageContent }],
    });

    const text = response.content[0].text.trim();
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    classifications = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
  } catch (err) {
    console.error("Claude Vision analysis failed, using fallback:", err.message);
    classifications = fallbackClassification(imageContents);
  }

  // Process images with sharp
  const processedImages = [];
  const usedCategories = new Set();

  for (const cls of classifications) {
    const imgData = imageContents.find((i) => i.index === cls.index);
    if (!imgData) continue;

    const metadata = await sharp(imgData.localPath).metadata();
    const imgW = metadata.width || 1280;
    const imgH = metadata.height || 960;

    // Primary image: resize to SUUMO spec
    if (!usedCategories.has(cls.primaryCategory)) {
      const cat = SUUMO_CATEGORIES.find((c) => c.id === cls.primaryCategory);
      const outPath = path.join(
        outputDir,
        `cat_${cls.primaryCategory}_${cls.index}.jpg`
      );
      await sharp(imgData.localPath)
        .resize({ width: 1280, height: 960, fit: "cover", position: "centre" })
        .jpeg({ quality: 85 })
        .toFile(outPath);

      processedImages.push({
        localPath: outPath,
        categoryId: cls.primaryCategory,
        categoryLabel: cat?.label || cls.primaryCategory,
        sourceIndex: cls.index,
      });
      usedCategories.add(cls.primaryCategory);
    }

    // Secondary crops
    for (const crop of cls.cropSuggestions || []) {
      if (usedCategories.has(crop.categoryId)) continue;

      const cropX = Math.round((crop.x || 0) * imgW);
      const cropY = Math.round((crop.y || 0) * imgH);
      const cropW = Math.round((crop.width || 0.5) * imgW);
      const cropH = Math.round((crop.height || 0.5) * imgH);

      // Skip if crop is too small
      if (cropW < 200 || cropH < 150) continue;
      // Clamp to image bounds
      const safeX = Math.min(cropX, imgW - cropW);
      const safeY = Math.min(cropY, imgH - cropH);
      if (safeX < 0 || safeY < 0) continue;

      const cat = SUUMO_CATEGORIES.find((c) => c.id === crop.categoryId);
      const outPath = path.join(
        outputDir,
        `cat_${crop.categoryId}_crop_${cls.index}.jpg`
      );

      try {
        await sharp(imgData.localPath)
          .extract({
            left: safeX,
            top: safeY,
            width: cropW,
            height: cropH,
          })
          .resize({ width: 1280, height: 960, fit: "cover" })
          .jpeg({ quality: 85 })
          .toFile(outPath);

        processedImages.push({
          localPath: outPath,
          categoryId: crop.categoryId,
          categoryLabel: cat?.label || crop.categoryId,
          sourceIndex: cls.index,
          isCrop: true,
        });
        usedCategories.add(crop.categoryId);
      } catch (err) {
        console.error(`Crop failed for cat ${crop.categoryId}:`, err.message);
      }
    }
  }

  // Sort: 5-point categories first
  return processedImages.sort((a, b) => {
    const scoreA =
      SUUMO_CATEGORIES.find((c) => c.id === a.categoryId)?.score || 0;
    const scoreB =
      SUUMO_CATEGORIES.find((c) => c.id === b.categoryId)?.score || 0;
    return scoreB - scoreA;
  });
}

/**
 * Fallback: assign categories sequentially when Claude Vision fails.
 */
function fallbackClassification(imageContents) {
  const defaultOrder = ["05", "01", "02", "03", "04", "06", "08", "09", "10"];
  return imageContents.map((img, i) => ({
    index: img.index,
    primaryCategory: defaultOrder[i % defaultOrder.length],
    secondaryCategories: [],
    cropSuggestions: [],
    quality: 3,
  }));
}

module.exports = { analyzeAndCropImages, SUUMO_CATEGORIES };
