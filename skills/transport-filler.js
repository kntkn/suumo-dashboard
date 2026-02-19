/**
 * Transport Filler — forrent.jp 交通情報入力
 *
 * Fills the cascading ensen (沿線) → station (駅) → walk (徒歩) selects
 * on the forrent.jp property registration form.
 * REINS data provides up to 3 transport lines.
 */

const TRANSPORT_SELECTORS = {
  ensen: [
    'select[name*="ensenCd1"]',
    'select[name*="ensenCd2"]',
    'select[name*="ensenCd3"]',
  ],
  eki: [
    'select[name*="ekiCd1"]',
    'select[name*="ekiCd2"]',
    'select[name*="ekiCd3"]',
  ],
  toho: [
    'input[name*="tohoFun1"]',
    'input[name*="tohoFun2"]',
    'input[name*="tohoFun3"]',
  ],
};

/**
 * Fill transport fields (up to 3 lines) from REINS 交通 data.
 *
 * @param {import('playwright').Frame} mainFrame - The main frame of forrent.jp
 * @param {Array<{沿線: string, 駅: string, 徒歩: string}>} transportArray
 * @returns {{filled: string[], errors: string[]}}
 */
async function fillTransport(mainFrame, transportArray) {
  const filled = [];
  const errors = [];

  if (!transportArray?.length) return { filled, errors };

  for (let i = 0; i < Math.min(transportArray.length, 3); i++) {
    const t = transportArray[i];
    if (!t.沿線 || !t.駅) continue;

    const lineName = normalize(t.沿線);
    const stationName = normalize(t.駅);
    const walkMin = String(parseInt(t.徒歩) || 0);

    // Select 沿線
    const ensenOk = await safeSelectPartial(
      mainFrame,
      TRANSPORT_SELECTORS.ensen[i],
      lineName
    );
    if (ensenOk) {
      filled.push(`沿線${i + 1}: ${lineName}`);
      // Wait for station cascade to load
      await mainFrame.waitForTimeout(2000);

      // Select 駅
      const ekiOk = await safeSelectPartial(
        mainFrame,
        TRANSPORT_SELECTORS.eki[i],
        stationName
      );
      if (ekiOk) {
        filled.push(`駅${i + 1}: ${stationName}`);
      } else {
        errors.push(`駅${i + 1}: "${stationName}" が見つかりません`);
      }
      await mainFrame.waitForTimeout(500);
    } else {
      errors.push(`沿線${i + 1}: "${lineName}" が見つかりません`);
    }

    // Fill 徒歩分数
    try {
      await mainFrame.fill(TRANSPORT_SELECTORS.toho[i], walkMin);
      filled.push(`徒歩${i + 1}: ${walkMin}分`);
      await mainFrame.waitForTimeout(200);
    } catch (e) {
      errors.push(`徒歩${i + 1}: ${e.message.slice(0, 60)}`);
    }
  }

  return { filled, errors };
}

/**
 * Select an option by partial text match.
 * Tries exact match first, then partial match.
 */
async function safeSelectPartial(frame, selector, targetText) {
  try {
    await frame.selectOption(selector, { label: targetText });
    return true;
  } catch {
    // Try partial match
    try {
      const matchedValue = await frame.evaluate(
        ({ sel, text }) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const options = Array.from(el.options);
          const match =
            options.find((o) => o.text === text) ||
            options.find((o) => o.text.includes(text)) ||
            options.find((o) =>
              text.includes(o.text.replace(/（.*）/, "").trim())
            );
          return match?.value ?? null;
        },
        { sel: selector, text: targetText }
      );

      if (matchedValue) {
        await frame.selectOption(selector, matchedValue);
        return true;
      }
    } catch {
      // Both attempts failed
    }
  }
  return false;
}

/**
 * Normalize full-width characters to half-width.
 */
function normalize(str) {
  if (!str) return "";
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
    .replace(/　/g, " ")
    .trim();
}

module.exports = { fillTransport, TRANSPORT_SELECTORS };
