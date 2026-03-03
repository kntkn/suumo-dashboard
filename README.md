# suumo-dashboard

REINS物件データの取得からforrent.jp（SUUMO）への入稿までを自動化するダッシュボード。AIによる画像分類・テキスト生成、リアルタイム進捗表示付き。

## Tech Stack

- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4
- **Backend**: Express + Socket.io (custom server)
- **Browser Automation**: Playwright (Chromium, headed)
- **AI**: Anthropic Claude API (画像分類 + テキスト生成)
- **Data**: Notion API

## Prerequisites

- Node.js 18+
- Anthropic API Key
- Notion API Token + Database ID
- REINS / forrent.jp のアカウント
- **デスクトップ環境が必須**（`headless: false` でブラウザが表示される）

## Setup

```bash
# Clone
git clone https://github.com/kntkn/suumo-dashboard.git
cd suumo-dashboard

# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Configure environment variables
cp .env.example .env.local
# Edit .env.local and fill in your credentials
```

### Environment Variables

`.env.example` を `.env.local` にコピーして、以下を設定:

| Variable | Required | Description |
|---|---|---|
| `REINS_LOGIN_ID` | Yes | REINS ログインID |
| `REINS_LOGIN_PASS` | Yes | REINS ログインパスワード |
| `SUUMO_LOGIN_ID` | Yes | forrent.jp ログインID |
| `SUUMO_LOGIN_PASS` | Yes | forrent.jp ログインパスワード |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `NOTION_TOKEN` | Yes | Notion API token |
| `NOTION_DATABASE_ID` | Yes | 物件データベース ID |
| `ITANDI_EMAIL` | No | ITANDI BB メールアドレス |
| `ITANDI_PASSWORD` | No | ITANDI BB パスワード |
| `IELOVEBB_EMAIL` | No | いえらぶBB メールアドレス |
| `IELOVEBB_PASSWORD` | No | いえらぶBB パスワード |
| `PORT` | No | Server port (default: 3456) |

## Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

http://localhost:3456 にアクセス。
