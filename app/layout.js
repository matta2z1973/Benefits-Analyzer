export const metadata = {
  title: "Benefits Plan Advisor | Greenhill School",
  description: "Find the right healthcare plan for you and your family.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
