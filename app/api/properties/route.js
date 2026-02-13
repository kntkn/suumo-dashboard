import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function GET() {
  try {
    const db = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      sorts: [{ property: "予測反響数", direction: "descending" }],
      page_size: 20,
    });

    const properties = db.results.map((p) => {
      const props = p.properties;
      const getText = (key) => props[key]?.rich_text?.[0]?.plain_text || "";
      const getTitle = () => props["REINS_ID"]?.title?.[0]?.plain_text || "";
      return {
        id: p.id,
        reinsId: getTitle(),
        rent: getText("賃料"),
        area: getText("占有面積"),
        station: getText("最寄り駅"),
        line: getText("路線"),
        walk: getText("徒歩"),
        address: getText("所在地"),
        age: getText("築年数"),
        structure: getText("構造（RCほか）"),
        managementIncluded: props["管理費込"]?.checkbox || false,
        predictedResponses: props["予測反響数"]?.number || 0,
      };
    });

    return Response.json(properties);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
