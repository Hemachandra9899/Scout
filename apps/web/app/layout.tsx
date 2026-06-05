import "./globals.css";

export const metadata = {
  title: "RLM Forge",
  description: "Recursive AI Research + Knowledge OS",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
