// src/app/api/actuator/route.ts
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

// Pico가 주기적으로 호출해 현재 제어 명령을 받아감 (GET)
export async function GET() {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT led_r, led_g, led_b, servo_angle FROM actuator_state WHERE id = 1"
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

// 사람이 Postman 등으로 원하는 제어값을 설정 (POST) — 3주차 대시보드가 대신하게 될 역할
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { led_r, led_g, led_b, servo_angle } = body;

    await pool.query(
      `UPDATE actuator_state
       SET led_r = ?, led_g = ?, led_b = ?, servo_angle = ?
       WHERE id = 1`,
      [led_r, led_g, led_b, servo_angle]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}