"""
pi/mock_pi_02.py — Pico2 W 가상 시뮬레이터 (2주차 종합 실습 연동 테스트용)

실제 Raspberry Pi Pico 2 W 보드 및 물리 센서/액추에이터 없이도
동일한 Windows PC에서 실행 중인 Next.js(TS) + MySQL 서버와 연동을 테스트할 수 있는 시뮬레이터입니다.

[비교: pi/code_02.py vs mock_pi_02.py]
- Wi-Fi 및 CircuitPython 하드웨어 라이브러리(board, analogio, pwmio, adafruit_*) 대신
  표준 Python 라이브러리와 requests 모듈을 사용하여 PC에서 독립 실행됩니다.
- 센서 송신(3.0초 주기) / 액추에이터 수신(2.0초 주기) 주기 및 통신 엔드포인트는 동일합니다.

[사용 방법]
1. Next.js 개발 서버 실행:
   npm run dev
2. 가상 시뮬레이터 실행 (별도 터미널):
   python mock_pi_02.py (또는 python pi/mock_pi_02.py)
"""

import functools
import os
import random
import sys
import time
import requests

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

# ── 서버 설정 ──
# Next.js 서버 주소 (기본값: 동일 PC의 http://localhost:3000)
# 환경변수 API_BASE_URL 이 설정되어 있으면 해당 값을 우선 사용합니다.
api_base = os.getenv("API_BASE_URL", "http://localhost:3000").rstrip("/")

print("=" * 68)
print("  [Pico 2 W Virtual Simulator / 가상 시뮬레이터]  mock_pi_02.py")
print(f"  * 연동 대상 서버 (Server URL) : {api_base}")
print("  * 센서 전송 주기 (Sensor POST): 매 3.0초 -> /api/sensor")
print("  * 명령 확인 주기 (Actuator GET): 매 2.0초 -> /api/actuator")
print("  * 종료 방법 (Exit)             : Ctrl + C")
print("=" * 68)


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
        # code_02.py의 get_light_percent 공식: 100 - (raw / 65535 * 100) = percent
        # 따라서 raw = 65535 * (100 - percent) / 100
        raw = int(65535 * (100.0 - self._percent) / 100.0)
        return max(0, min(65535, raw))


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


# ── 센서 / 액추에이터 초기화 (pi/code_02.py 구조 준용) ──
cds = MockCDS(init_percent=65.0)
dht = MockDHT11(init_temp=24.5, init_hum=55.0)
rgb_led = MockRGBLED()
my_servo = MockServo()


def set_color(r, g, b):
    rgb_led.set_color(r, g, b)


def get_light_percent():
    raw = cds.value
    return round(100 - (raw / 65535 * 100), 1)


# ── 메인 루프 변수 ──
last_sensor_send = 0.0
last_actuator_check = 0.0
current_temp = 24.5

# 상태 변화 감지용 변수
prev_actuator_state = None

print(">> [START] 시뮬레이션 루프가 시작되었습니다.\n")

try:
    while True:
        now = time.monotonic()

        # 1) 3초마다 가상 센서값 측정 후 Next.js 서버(POST /api/sensor)로 전송
        if now - last_sensor_send > 3.0:
            response = None
            try:
                current_temp = dht.temperature
                humidity = dht.humidity
                light_percent = get_light_percent()

                payload = {
                    "temperature": current_temp,
                    "humidity": humidity,
                    "light_percent": light_percent,
                }

                response = requests.post(
                    f"{api_base}/api/sensor",
                    json=payload,
                    timeout=2.0
                )

                if response.status_code == 200:
                    print(
                        f"[SENSOR SEND / 센서 전송] "
                        f"온도(Temp): \033[91m{current_temp:>4.1f}°C\033[0m | "
                        f"습도(Hum): \033[94m{humidity:>4.1f}%\033[0m | "
                        f"조도(Light): \033[93m{light_percent:>4.1f}%\033[0m "
                        f"-> Response: {response.json()}"
                    )
                else:
                    print(
                        f"[SENSOR WARN / 센서 전송 경고] HTTP {response.status_code}: {response.text}"
                    )

            except requests.exceptions.ConnectionError:
                print(f"[CONN FAIL / 연결 실패] Next.js 서버({api_base})에 연결할 수 없습니다. (npm run dev 실행 확인 필요)")
            except requests.exceptions.Timeout:
                print("[TIMEOUT / 시간 초과] 센서값 전송 중 서버 응답 시간 초과")
            except Exception as e:
                print("[SENSOR ERR / 센서 전송 실패]:", e)
            finally:
                if response is not None:
                    response.close()
            last_sensor_send = now

        # 2) 2초마다 액추에이터 명령 확인(GET /api/actuator) 및 가상 반영
        if now - last_actuator_check > 2.0:
            response = None
            try:
                response = requests.get(
                    f"{api_base}/api/actuator",
                    timeout=2.0
                )

                if response.status_code == 200:
                    state = response.json()
                    r = state.get("led_r", 0)
                    g = state.get("led_g", 0)
                    b = state.get("led_b", 0)
                    servo_angle = state.get("servo_angle", 90)

                    # 이전 상태와 비교하여 변경되었는지 확인
                    curr_state = (r, g, b, servo_angle)
                    changed = (prev_actuator_state != curr_state)

                    set_color(r, g, b)
                    my_servo.angle = servo_angle

                    if changed:
                        print(
                            f"\033[92m[ACTUATOR UPDATE / 명령 수신 및 반영]\033[0m "
                            f"LED: {rgb_led.render()} | "
                            f"Servo: {my_servo.render()}"
                        )
                        prev_actuator_state = curr_state
                else:
                    print(
                        f"[ACTUATOR WARN / 액추에이터 조회 경고] HTTP {response.status_code}: {response.text}"
                    )

            except requests.exceptions.ConnectionError:
                pass  # 위 센서 전송 실패에서 이미 안내했으므로 과도한 반복 로그 방지
            except requests.exceptions.Timeout:
                print("[TIMEOUT / 시간 초과] 액추에이터 명령 조회 중 시간 초과")
            except Exception as e:
                print("[ACTUATOR ERR / 명령 수신 실패]:", e)
            finally:
                if response is not None:
                    response.close()
            last_actuator_check = now

        time.sleep(0.2)

except KeyboardInterrupt:
    print("\n\n[EXIT / 종료] 사용자에 의해 가상 시뮬레이터가 정상 종료되었습니다.")
