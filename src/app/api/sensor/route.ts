// src/app/api/sensor/route.ts
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// Pico가 센서값을 보낼 때 사용 (POST)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { temperature, humidity, light_percent } = body;

    if (
      typeof temperature !== "number" ||
      typeof humidity !== "number" ||
      typeof light_percent !== "number"
    ) {
      return NextResponse.json(
        { error: "temperature, humidity, light_percent는 숫자여야 합니다." },
        { status: 400 }
      );
    }

    await pool.query(
      "INSERT INTO sensor_logs (temperature, humidity, light_percent) VALUES (?, ?, ?)",
      [temperature, humidity, light_percent]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

// 최근 20개 기록 조회 (브라우저나 Postman에서 GET으로 확인용)
export async function GET() {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM sensor_logs ORDER BY id DESC LIMIT 20"
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}