import "./globals.css";

export const metadata = {
  title: "SUUMO Auto-Nyuko",
  description: "REINS → SUUMO 自動入稿ツール",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#08080a] text-white antialiased">{children}</body>
    </html>
  );
}
