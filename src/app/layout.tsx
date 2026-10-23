// src/app/layout.tsx
import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap.min.css"; // 반드시 globals.css보다 먼저
import "./globals.css";

export const metadata: Metadata = {
  title: "스마트 제어반",
  description: "실시간 센서 모니터링 및 액추에이터 제어",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-bs-theme="dark" 한 줄로 전체가 다크 테마가 됩니다 (Bootstrap 5.3 이상)
  return (
    <html lang="ko" data-bs-theme="dark">
      <body>{children}</body>
    </html>
  );
}