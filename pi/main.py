# main.py — 9주차: 센서 다섯 개를 보내는 WebSocket 서버
import os
import json
import time
import board
import analogio
import pwmio
import wifi
import socketpool
import microcontroller          # ★ 9주차 추가 — 칩 내부 온도 센서 (부품 불필요)
import adafruit_dht
from adafruit_motor import servo
from adafruit_httpserver import GET, Request, Server, Websocket
from asyncio import create_task, gather, run, sleep as async_sleep

# ── Wi-Fi 연결 ──
ssid = os.getenv("CIRCUITPY_WIFI_SSID")
password = os.getenv("CIRCUITPY_WIFI_PASSWORD")

print("Wi-Fi 연결 중...")
wifi.radio.connect(ssid, password)
print("연결 완료! 내 IP 주소:", wifi.radio.ipv4_address)

pool = socketpool.SocketPool(wifi.radio)
server = Server(pool, debug=True)

# ── 센서 초기화 ──
cds = analogio.AnalogIn(board.GP26)
dht = adafruit_dht.DHT11(board.GP16)

# ── 액추에이터 초기화 ──
red = pwmio.PWMOut(board.GP17, frequency=1000, duty_cycle=0)
green = pwmio.PWMOut(board.GP18, frequency=1000, duty_cycle=0)
blue = pwmio.PWMOut(board.GP19, frequency=1000, duty_cycle=0)

servo_pwm = pwmio.PWMOut(board.GP15, duty_cycle=2 ** 15, frequency=50)
my_servo = servo.Servo(servo_pwm, min_pulse=500, max_pulse=2500)


def set_color(r, g, b):
    red.duty_cycle = int(r / 255 * 65535)
    green.duty_cycle = int(g / 255 * 65535)
    blue.duty_cycle = int(b / 255 * 65535)


def get_light_percent():
    raw = cds.value
    return round(100 - (raw / 65535 * 100), 1)


def get_cpu_temp():
    """★ 9주차 추가 — RP2350 칩 안에 들어있는 온도 센서. 부품이 필요 없다.
    칩이 스스로 열을 내므로 방 온도보다 높게 나오는 것이 정상이다."""
    try:
        return round(microcontroller.cpu.temperature, 1)
    except Exception as e:
        print("[SENSOR] 칩 온도 읽기 실패:", e)
        return None


def get_discomfort(t, h):
    """★ 9주차 추가 — 불쾌지수(DI). 온도와 습도로 계산하므로 센서가 따로 없어도 된다.
    68 미만 쾌적 / 68~75 보통 / 75~80 다소 불쾌 / 80 이상 매우 불쾌"""
    if t is None or h is None:
        return None
    return round(0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3, 1)


websocket: Websocket = None


@server.route("/connect-websocket", GET)
def connect_client(request: Request):
    global websocket
    client_ip, client_port = request.client_address
    if websocket is not None:
        print(f"[WS] 기존 연결 종료 (새 클라이언트: {client_ip}:{client_port})")
        websocket.close()
    else:
        print(f"[WS] 클라이언트 연결됨: {client_ip}:{client_port}")
    websocket = Websocket(request)
    return websocket


server.start(str(wifi.radio.ipv4_address), port=5000)
print(f"WebSocket 서버 시작: ws://{wifi.radio.ipv4_address}:5000/connect-websocket")


async def handle_http_requests():
    while True:
        server.poll()
        await async_sleep(0)


async def handle_websocket_requests():
    """브라우저가 보낸 제어 명령(JSON)을 받아 즉시 반영"""
    global websocket
    while True:
        if websocket is not None:
            try:
                message = websocket.receive(fail_silently=True)
            except Exception as e:
                print("[WS] 수신 중 연결 끊김 감지:", e)
                websocket = None
                message = None

            if message:
                print("[WS] 수신 메시지:", message)
                try:
                    command = json.loads(message)
                    # ★ 9주차 수정 — command["led_r"] 대신 command.get("led_r", 0)
                    # 키가 하나 빠져도 나머지 명령은 그대로 실행된다.
                    set_color(
                        command.get("led_r", 0),
                        command.get("led_g", 0),
                        command.get("led_b", 0),
                    )
                    if "servo_angle" in command:
                        my_servo.angle = command["servo_angle"]
                    print("[WS] 명령 적용 완료:", command)
                except Exception as e:
                    print("[WS] 명령 파싱/적용 오류:", e)
        await async_sleep(0)


async def send_sensor_messages():
    """1초마다 센서값을 JSON으로 push (DHT11은 최소 2초 간격이 필요해 읽기 주기를 따로 관리)"""
    global websocket
    # ★ 9주차 수정 — 3주차에는 25로 시작해서, 아직 못 읽었는데도 25도를 보냈다.
    # 없는 값을 지어내면 안 된다. 없으면 None(화면에서는 "--")으로 보낸다.
    last_temp = None
    last_humidity = None
    last_dht_read = 0
    while True:
        if websocket is not None:
            now = time.monotonic()
            if now - last_dht_read > 2.0:
                try:
                    last_temp = dht.temperature
                    last_humidity = dht.humidity
                except RuntimeError as e:
                    print("[SENSOR] DHT11 읽기 재시도:", e)  # 실패하면 직전 값 유지
                last_dht_read = now

            payload = json.dumps(
                {
                    "temperature": last_temp,
                    "humidity": last_humidity,
                    "light_percent": get_light_percent(),
                    # ★ 9주차 추가 — 키 두 개가 늘었다
                    "cpu_temp": get_cpu_temp(),
                    "discomfort": get_discomfort(last_temp, last_humidity),
                }
            )
            print("[WS] 송신 메시지:", payload)
            try:
                websocket.send_message(payload, fail_silently=True)
            except Exception as e:
                print("[WS] 송신 중 연결 끊김 감지:", e)
                websocket = None
        else:
            print("[WS] 대기 중 — 아직 연결된 클라이언트 없음")
        await async_sleep(1)


async def main():
    await gather(
        create_task(handle_http_requests()),
        create_task(handle_websocket_requests()),
        create_task(send_sensor_messages()),
    )


run(main())