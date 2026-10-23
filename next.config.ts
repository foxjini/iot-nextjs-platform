// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 실습실 공유기 3대가 쓰는 IP 대역을 모두 허용
  // ipconfig로 확인한 내 PC의 대역이 아래 목록에 없으면 직접 추가하세요
  allowedDevOrigins: ["192.168.0.*", "192.168.1.*", "172.30.1.*"],
};

export default nextConfig;