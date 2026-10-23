"""
pi/mock_pi_09.py — Pico2 W 가상 시뮬레이터 (9주차: 센서 5종 WebSocket 서버 연동 테스트용)

실제 Raspberry Pi Pico 2 W 보드 및 물리 센서/액추에이터 없이도
동일한 Windows PC에서 브라우저(Next.js 대시보드)와 WebSocket으로 통신하며 연동을 테스트할 수 있는 시뮬레이터입니다.

기반 원본: pi/code_09.py
- 센서 5개 전송: temperature, humidity, light_percent, cpu_temp, discomfort
- 액추에이터 제어: led_r, led_g, led_b, servo_angle
- WebSocket 포트: 5000 (/connect-websocket)
- 센서 push 주기: 1.0초

[사용 방법]
1. 가상 시뮬레이터 실행:
   python pi/mock_pi_09.py (또는 python mock_pi_09.py)
2. Next.js 대시보드 접속:
   http://localhost:3000/dashboard
3. 대시보드 상단 '설정'에서 Pico IP를 'localhost' 또는 '127.0.0.1'로 입력 후 연결
"""

import asyncio
import functools
import json
import os
import random
import socket
import sys
import time
import websockets

# Windows 콘솔 인코딩(UTF-8) 및 ANSI 이스케이프 시퀀스 활성화
if sys.platform == "win32":
    os.system("")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 실시간 콘솔 출력을 위해 flush=True 기본 설정
print = functools.partial(print, flush=True)


# ── 가상 센서 시뮬레이션 클래스 ──
class MockDHT11:
    """DHT11 온습도 센서 가상 시뮬레이터 (GP16 핀 시뮬레이션)"""

    def __init__(self, init_temp=24.0, init_hum=55.0):
        self._temp = init_temp
        self._hum = init_hum

    @property
    def temperature(self):
        # 18.0°C ~ 32.0°C 범위에서 ±0.3°C 내외로 자연스럽게 변동
        delta = random.uniform(-0.3, 0.3)
        self._temp = max(18.0, min(32.0, self._temp + delta))
        return round(self._temp, 1)

    @property
    def humidity(self):
        # 35% ~ 80% 범위에서 ±0.8% 내외로 자연스럽게 변동
        delta = random.uniform(-0.8, 0.8)
        self._hum = max(35.0, min(80.0, self._hum + delta))
        return round(self._hum, 1)


class MockCDS:
    """CDS 조도 센서 가상 시뮬레이터 (GP26 아날로그 핀 시뮬레이션, 16-bit ADC: 0 ~ 65535)"""

    def __init__(self, init_percent=65.0):
        self._percent = init_percent

    @property
    def value(self):
        # 조도(%)를 10% ~ 95% 범위에서 자연스럽게 변동
        delta = random.uniform(-1.5, 1.5)
        self._percent = max(10.0, min(95.0, self._percent + delta))
        # 100 - (raw / 65535 * 100) = percent 이므로
        # raw = 65535 * (100 - percent) / 100
        raw = int(65535 * (100.0 - self._percent) / 100.0)
        return max(0, min(65535, raw))


class MockCPU:
    """RP2350 마이크로컨트롤러 칩 내부 온도 센서 가상 시뮬레이터"""

    def __init__(self, init_temp=38.5):
        self._temp = init_temp

    @property
    def temperature(self):
        # 칩 발열로 방 온도보다 높음 (36.0°C ~ 44.0°C 범위에서 변동)
        delta = random.uniform(-0.2, 0.2)
        self._temp = max(36.0, min(44.0, self._temp + delta))
        return round(self._temp, 1)


# ── 가상 액추에이터 시뮬레이션 클래스 ──
class MockRGBLED:
    """RGB LED 가상 시뮬레이터 (GP17, GP18, GP19 PWM 제어 시뮬레이션)"""

    def __init__(self):
        self.r = 0
        self.g = 0
        self.b = 0

    def set_color(self, r, g, b):
        self.r = max(0, min(255, int(r)))
        self.g = max(0, min(255, int(g)))
        self.b = max(0, min(255, int(b)))

    def render(self):
        if self.r == 0 and self.g == 0 and self.b == 0:
            return "\033[90m[OFF (꺼짐)]\033[0m"
        # 터미널 24-bit TrueColor 색상 블록 표시
        ansi_box = f"\033[38;2;{self.r};{self.g};{self.b}m■■■\033[0m"
        return f"{ansi_box} RGB({self.r}, {self.g}, {self.b})"


class MockServo:
    """서보 모터 가상 시뮬레이터 (GP15 PWM 서보 제어 시뮬레이션: 0 ~ 180도)"""

    def __init__(self):
        self.angle = 90

    def render(self):
        # 0 ~ 180도를 18칸 게이지로 시각화
        angle = max(0, min(180, int(self.angle)))
        pos = int(round(angle / 180.0 * 18))
        gauge = ["-"] * 19
        if 0 <= pos <= 18:
            gauge[pos] = "\033[93m▲\033[0m"
        return f"[{''.join(gauge)}] {angle:>3}°"


# ── 센서 / 액추에이터 초기화 (pi/code_09.py 구조 준용) ──
cds = MockCDS(init_percent=65.0)
dht = MockDHT11(init_temp=24.5, init_hum=55.0)
cpu = MockCPU(init_temp=38.5)
rgb_led = MockRGBLED()
my_servo = MockServo()


def set_color(r, g, b):
    rgb_led.set_color(r, g, b)


def get_light_percent():
    raw = cds.value
    return round(100 - (raw / 65535 * 100), 1)


def get_cpu_temp():
    """★ 9주차 추가 — RP2350 칩 내부 온도 센서 가상 시뮬레이션"""
    try:
        return cpu.temperature
    except Exception as e:
        print("[SENSOR] 칩 온도 읽기 실패:", e)
        return None


def get_discomfort(t, h):
    """★ 9주차 추가 — 불쾌지수(DI) 계산식
    68 미만: 쾌적 / 68~75: 보통 / 75~80: 다소 불쾌 / 80 이상: 매우 불쾌"""
    if t is None or h is None:
        return None
    return round(0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3, 1)


# 연결된 웹소켓 클라이언트 집합
connected_clients = set()


async def handle_client(websocket):
    """웹소켓 클라이언트 연결 처리 및 수신된 제어 명령 반영 (code_09.py handle_websocket_requests 대응)"""
    remote_addr = websocket.remote_address
    client_ip = remote_addr[0] if remote_addr else "127.0.0.1"
    client_port = remote_addr[1] if remote_addr else "unknown"

    print(f"[WS] 클라이언트 연결됨: {client_ip}:{client_port}")
    connected_clients.add(websocket)

    try:
        async for message in websocket:
            print(f"[WS] 수신 메시지: {message}")
            try:
                command = json.loads(message)

                # ★ 9주차 수정 — command.get("led_r", 0) 방식으로 키 누락 시에도 안전하게 실행
                r = int(command.get("led_r", 0))
                g = int(command.get("led_g", 0))
                b = int(command.get("led_b", 0))
                set_color(r, g, b)

                if "servo_angle" in command:
                    my_servo.angle = int(command["servo_angle"])

                print(
                    f"[WS] 명령 적용 완료: {command} "
                    f"| {rgb_led.render()} | {my_servo.render()}"
                )
            except Exception as e:
                print(f"[WS] 명령 파싱/적용 오류: {e}")

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"[WS] 수신 중 연결 끊김 감지: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] 클라이언트 연결 종료: {client_ip}:{client_port}")


async def send_sensor_messages():
    """1초마다 센서 5종의 값을 JSON으로 push (code_09.py send_sensor_messages 대응)"""
    # ★ 9주차 수정 — 초기값은 None으로 시작 (없는 값을 지어내지 않고 읽기 성공 후 전송)
    last_temp = None
    last_humidity = None
    last_dht_read = 0.0

    while True:
        if connected_clients:
            now = time.monotonic()
            # DHT11은 최소 2초 주기로 읽음
            if now - last_dht_read > 2.0:
                try:
                    last_temp = dht.temperature
                    last_humidity = dht.humidity
                except Exception as e:
                    print(f"[SENSOR] DHT11 읽기 재시도: {e}")
                last_dht_read = now

            # ★ 9주차 추가 — 5개 센서 키 구성
            payload_data = {
                "temperature": last_temp,
                "humidity": last_humidity,
                "light_percent": get_light_percent(),
                "cpu_temp": get_cpu_temp(),
                "discomfort": get_discomfort(last_temp, last_humidity),
            }
            payload = json.dumps(payload_data, ensure_ascii=False)
            print(f"[WS] 송신 메시지: {payload}")

            # 연결된 모든 클라이언트(브라우저)에 브로드캐스트 전송
            closed_clients = set()
            for ws in list(connected_clients):
                try:
                    await ws.send(payload)
                except Exception as e:
                    print(f"[WS] 송신 중 연결 끊김 감지: {e}")
                    closed_clients.add(ws)

            connected_clients.difference_update(closed_clients)
        else:
            print("[WS] 대기 중 - 아직 연결된 클라이언트 없음")

        await asyncio.sleep(1.0)


def get_local_ip():
    """PC의 로컬 네트워크 IP 주소 확인"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


async def main():
    host = "0.0.0.0"
    port = 5000
    local_ip = get_local_ip()

    print("=" * 70)
    print("  [Pico 2 W Virtual Simulator (Week 9)] mock_pi_09.py")
    print(f"  * 내 IP 주소 (Local IP)      : {local_ip}")
    print(f"  * WebSocket 포트 (Port)      : {port}")
    print(f"  * 로컬 접속 주소 (Local URL)  : ws://localhost:{port}/connect-websocket")
    print(f"  * LAN 접속 주소 (LAN URL)     : ws://{local_ip}:{port}/connect-websocket")
    print("  * 센서 5종 송신 (Sensor Push) : temperature, humidity, light, cpu, discomfort")
    print("  * 제어 명령 수신 (Actuator)   : LED(R,G,B) / Servo angle 수신 즉시 반영")
    print("  * 종료 방법 (Exit)            : Ctrl + C")
    print("=" * 70)

    try:
        async with websockets.serve(handle_client, host, port):
            print(f"\nWebSocket 서버 시작: ws://{local_ip}:{port}/connect-websocket")
            print(">> [READY] Next.js 대시보드(브라우저)의 연결을 기다리는 중...\n")
            await send_sensor_messages()
    except OSError as e:
        if "address already in use" in str(e).lower() or e.errno == 10048:
            print(f"\n❌ [오류] 포트 {port}가 이미 사용 중입니다. 기존 프로세스를 종료한 뒤 다시 실행하세요.")
        else:
            print(f"\n❌ [오류] 서버 실행 실패: {e}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n[종료] 사용자에 의해 WebSocket 가상 시뮬레이터가 정상 종료되었습니다.")
