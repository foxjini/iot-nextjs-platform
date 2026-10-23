# -*- coding: utf-8 -*-
"""12주차 디자인 스타일과 레이아웃

실제 Raspberry Pi Pico 2 W 가 없어도 12주차 실습을 그대로 할 수 있게 해 주는
가상 Pico 입니다. 윈도우 PC 의 파이썬으로 실행합니다.

  py mock_pi_12.py

설치할 것이 없습니다. 파이썬 표준 라이브러리만 씁니다.
시리얼 모니터에 찍히는 문구도 진짜 Pico 와 똑같이 맞췄으므로,
교재에 나오는 시리얼 모니터 문구를 그대로 따라갈 수 있습니다.

11주차와 같은 값을 보내되, 레이아웃을 비교할 수 있도록 센서를 6개로 채워 둡니다.
  temperature, humidity, light_percent, cpu_temp, discomfort, soil

'대형 강조' 레이아웃은 SENSORS 배열의 첫 번째를 주인공으로 삼습니다.
우리 팀 주인공 센서를 맨 앞으로 옮긴 뒤 이 파일로 확인해 보세요.

명암비를 눈으로 재려면 값이 계속 움직여야 합니다. 이 파일은 그대로 두고
브라우저에서 스타일 버튼만 눌러 가며 비교하세요.
"""
import json
import random
import socket
import sys
import threading
import time

# ────────────────────────────────────────────────────────────────
#  여기부터 WebSocket 서버 — 학생은 고칠 필요가 없습니다
# ────────────────────────────────────────────────────────────────
import base64
import hashlib
import struct

PORT = 5000
PATH = "/connect-websocket"
_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def lan_ip():
    """이 PC 가 공유기에서 받은 IP. 진짜 Pico 가 시리얼에 찍는 것과 같은 자리."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))       # 실제로 보내지는 않고 경로만 확인
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _recv_exactly(conn, n):
    buf = b""
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def _handshake(conn):
    raw = b""
    while b"\r\n\r\n" not in raw:
        chunk = conn.recv(1024)
        if not chunk:
            return None
        raw += chunk
        if len(raw) > 65536:
            return None
    head = raw.decode("utf-8", "ignore").split("\r\n")
    path = head[0].split(" ")[1] if len(head[0].split(" ")) > 1 else "/"
    headers = {}
    for line in head[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    key = headers.get("sec-websocket-key")
    if not key:
        conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        return None
    accept = base64.b64encode(hashlib.sha1((key + _GUID).encode()).digest()).decode()
    conn.sendall(
        b"HTTP/1.1 101 Switching Protocols\r\n"
        b"Upgrade: websocket\r\n"
        b"Connection: Upgrade\r\n"
        b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n"
    )
    return path


def _encode_text(message):
    payload = message.encode("utf-8")
    n = len(payload)
    head = bytearray([0x81])
    if n < 126:
        head.append(n)
    elif n < 65536:
        head.append(126)
        head += struct.pack(">H", n)
    else:
        head.append(127)
        head += struct.pack(">Q", n)
    return bytes(head) + payload


def _read_frame(conn):
    """(opcode, payload) 를 돌려준다. 끊기면 (None, None)."""
    head = _recv_exactly(conn, 2)
    if not head:
        return None, None
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    length = head[1] & 0x7F
    if length == 126:
        ext = _recv_exactly(conn, 2)
        if not ext:
            return None, None
        length = struct.unpack(">H", ext)[0]
    elif length == 127:
        ext = _recv_exactly(conn, 8)
        if not ext:
            return None, None
        length = struct.unpack(">Q", ext)[0]
    mask = _recv_exactly(conn, 4) if masked else None
    data = _recv_exactly(conn, length) if length else b""
    if data is None or (masked and mask is None):
        return None, None
    if mask:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return opcode, data

import math

SEND_INTERVAL = 1.0          # 진짜 Pico 와 같이 1초마다 보낸다

# 지금 재현하고 있는 상황. 콘솔에서 바꿀 수 있습니다.
STATE = {"dark": False, "hot": False, "dht_broken": False, "cds_broken": False}

# 브라우저가 보낸 마지막 제어 명령 (진짜 Pico 의 LED/서보 자리)
ACTUATOR = {"led_r": 0, "led_g": 0, "led_b": 0, "servo_angle": 90}


def _temperature(n):
    if STATE["dht_broken"]:
        return None
    if STATE["hot"]:
        return 31.5
    return round(24 + math.sin(n / 5.0) * 3, 1)


def _humidity(n):
    if STATE["dht_broken"]:
        return None
    if STATE["hot"]:
        return 85
    return round(55 + math.cos(n / 7.0) * 10)


def _light_percent(n):
    if STATE["cds_broken"]:
        return None
    if STATE["dark"]:
        return 18.0
    return round(60 + math.sin(n / 3.0) * 20, 1)


def apply_command(command):
    """브라우저가 보낸 JSON 을 진짜 Pico 처럼 적용한다."""
    for key in ("led_r", "led_g", "led_b", "servo_angle"):
        if key in command:
            ACTUATOR[key] = command[key]
    print("[WS] 명령 적용 완료:", json.dumps(command, ensure_ascii=False))
    print("      -> LED:({}, {}, {})  서보:{}도".format(
        ACTUATOR["led_r"], ACTUATOR["led_g"], ACTUATOR["led_b"], ACTUATOR["servo_angle"]))


def _discomfort(t, h):
    """불쾌지수. 온도나 습도가 없으면 계산할 수 없으므로 None."""
    if t is None or h is None:
        return None
    return round(0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3, 1)


def _cpu_temp(n):
    return round(38 + math.sin(n / 11.0) * 2, 1)


# 팀이 새로 붙일 센서를 여기서 재현합니다. 콘솔에서 add 로 추가하세요.
TEAM = {}


def _team_values():
    out = {}
    for key, spec in TEAM.items():
        if spec["broken"]:
            out[key] = None
        else:
            lo, hi = spec["lo"], spec["hi"]
            spec["v"] += random.uniform(-(hi - lo) * 0.05, (hi - lo) * 0.05)
            spec["v"] = max(lo, min(hi, spec["v"]))
            out[key] = round(spec["v"], 1)
    return out


def _status():
    bits = []
    if STATE["dark"]:
        bits.append("어둡게")
    if STATE["hot"]:
        bits.append("덥게")
    if STATE["dht_broken"]:
        bits.append("DHT11 고장")
    if STATE["cds_broken"]:
        bits.append("조도센서 고장")
    return " + ".join(bits) if bits else "보통"


# 레이아웃 비교용으로 여섯 번째 센서를 미리 하나 켜 둡니다 (예시: 토양수분)
TEAM["soil"] = {"lo": 0.0, "hi": 100.0, "v": 45.0, "broken": False}


def build_payload(n):
    t = _temperature(n)
    h = _humidity(n)
    payload = {
        "temperature": t,
        "humidity": h,
        "light_percent": _light_percent(n),
        "cpu_temp": _cpu_temp(n),
        "discomfort": _discomfort(t, h),
    }
    payload.update(_team_values())
    return payload


def print_menu():
    print("[명령]  d 어둡게 / b 밝게 / h 덥게 / n 보통 / s 상태 / q 종료")
    print("        add <키> <최소> <최대>   센서 더 넣기   del <키>   빼기")
    print("        (레이아웃 비교용으로 soil 이 이미 들어가 있습니다)")


def handle_key(line):
    parts = line.split()
    key = parts[0]
    if key == "add" and len(parts) >= 2:
        name = parts[1]
        lo = float(parts[2]) if len(parts) > 2 else 0.0
        hi = float(parts[3]) if len(parts) > 3 else 100.0
        TEAM[name] = {"lo": lo, "hi": hi, "v": (lo + hi) / 2, "broken": False}
        print(">> '{}' 키를 {}~{} 범위로 보내기 시작합니다.".format(name, lo, hi))
        return
    if key == "del" and len(parts) >= 2:
        if TEAM.pop(parts[1], None) is not None:
            print(">> '{}' 키를 뺐습니다.".format(parts[1]))
        else:
            print(">> 그런 키가 없습니다.")
        return
    if key == "d":
        STATE["dark"] = True
        print(">> 조도를 18% 로 낮췄습니다.")
    elif key == "b":
        STATE["dark"] = False
        print(">> 조도를 보통으로 되돌렸습니다.")
    elif key == "h":
        STATE["hot"] = True
        print(">> 온도 31.5도 / 습도 85% 로 올렸습니다.")
    elif key == "n":
        STATE["dark"] = STATE["hot"] = False
        print(">> 전부 보통으로 되돌렸습니다.")
    elif key == "s":
        print(">> 지금 상태:", _status())
        print(">> 보내는 센서 키:", ", ".join(list(build_payload(1).keys())))
    else:
        print_menu()


# ────────────────────────────────────────────────────────────────
#  진짜 Pico 처럼 동작하는 부분
# ────────────────────────────────────────────────────────────────
_client_lock = threading.Lock()
_client = None          # 지금 붙어 있는 브라우저 (진짜 Pico 도 한 번에 하나)
_running = True
_listening = True       # False 면 "USB 를 뽑은" 상태


def _set_client(conn, addr):
    global _client
    with _client_lock:
        old = _client
        _client = conn
    if old is not None:
        print("[WS] 기존 연결 종료 (새 클라이언트: {}:{})".format(addr[0], addr[1]))
        try:
            old.close()
        except Exception:
            pass
    else:
        print("[WS] 클라이언트 연결됨: {}:{}".format(addr[0], addr[1]))


def _drop_client(conn):
    global _client
    with _client_lock:
        if _client is conn:
            _client = None
    try:
        # ★ close() 만으로는 상대가 끊긴 것을 모릅니다.
        #    다른 스레드가 이 소켓에서 recv() 로 멈춰 있으면, 그 recv 가 끝날 때까지
        #    FIN 이 나가지 않아 브라우저는 계속 "연결됨" 으로 남습니다.
        #    shutdown() 은 지금 바로 FIN 을 보내고 멈춰 있던 recv 도 깨웁니다.
        conn.shutdown(socket.SHUT_RDWR)
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


def _client_thread(conn, addr):
    path = None
    try:
        path = _handshake(conn)
    except Exception:
        path = None
    if path is None:
        conn.close()
        return
    if path.split("?")[0] != PATH:
        print("[WS] 경로가 다릅니다: {} (기대한 값 {})".format(path, PATH))
    _set_client(conn, addr)
    try:
        while _running:
            opcode, data = _read_frame(conn)
            if opcode is None:                        # TCP 가 끊어졌다
                break
            if opcode == 0x8:                         # 브라우저가 보낸 close
                try:
                    conn.sendall(b"\x88\x00")           # 예의상 close 를 되돌려준다
                except Exception:
                    pass
                break
            if opcode == 0x9:                         # ping -> pong
                try:
                    conn.sendall(b"\x8a\x00")
                except Exception:
                    break
                continue
            if opcode != 0x1:
                continue
            message = data.decode("utf-8", "ignore")
            print("[WS] 수신 메시지:", message)
            try:
                command = json.loads(message)
                apply_command(command)
            except Exception as e:
                print("[WS] 명령 파싱/적용 오류:", e)
    except Exception:
        pass
    finally:
        _drop_client(conn)
        print("[WS] 클라이언트 연결이 끊어졌습니다")


def _accept_loop():
    while _running:
        if not _listening:
            time.sleep(0.2)
            continue
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            srv.bind(("0.0.0.0", PORT))
            srv.listen(4)
            srv.settimeout(0.5)
        except OSError as e:
            print("[!] 포트 {} 을 열 수 없습니다: {}".format(PORT, e))
            print("    다른 가상 Pico 가 이미 켜져 있지 않은지 확인하세요.")
            time.sleep(2.0)
            srv.close()
            continue
        while _running and _listening:
            try:
                conn, addr = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            conn.settimeout(None)
            threading.Thread(target=_client_thread, args=(conn, addr), daemon=True).start()
        srv.close()


def _send_loop():
    n = 0
    while _running:
        n += 1
        with _client_lock:
            conn = _client
        if conn is not None:
            payload = json.dumps(build_payload(n), ensure_ascii=False)
            print("[WS] 송신 메시지:", payload)
            try:
                conn.sendall(_encode_text(payload))
            except Exception as e:
                print("[WS] 송신 중 연결 끊김 감지:", e)
                _drop_client(conn)
        else:
            print("[WS] 대기 중 — 아직 연결된 클라이언트 없음")
        time.sleep(SEND_INTERVAL)


def _console_loop():
    global _running, _listening
    while _running:
        try:
            line = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            _running = False
            break
        if not line:
            print_menu()
            continue
        if line in ("q", "quit", "exit"):
            _running = False
            break
        handle_key(line)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ip = lan_ip()
    print("=" * 62)
    print(" 가상 Pico 2 W - 12주차 디자인 스타일과 레이아웃")
    print("=" * 62)
    print("Wi-Fi 연결 중...")
    time.sleep(0.3)
    print("연결 완료! 내 IP 주소:", ip)
    print("WebSocket 서버 시작: ws://{}:{}{}".format(ip, PORT, PATH))
    print()
    print("대시보드의 IP 입력칸에 이 주소를 넣으세요 ->  " + ip)
    print("같은 PC 의 브라우저에서만 볼 거라면 127.0.0.1 도 됩니다.")
    print()
    print("처음 실행하면 윈도우 방화벽 창이 뜹니다. [개인 네트워크] 와 [공용 네트워크] 를 모두 체크하고")
    print("[액세스 허용] 을 누르세요.")
    print("-" * 62)
    print_menu()
    print("-" * 62)

    threading.Thread(target=_accept_loop, daemon=True).start()
    threading.Thread(target=_send_loop, daemon=True).start()
    console = threading.Thread(target=_console_loop, daemon=True)
    console.start()
    try:
        while _running:
            time.sleep(0.2)
    except KeyboardInterrupt:
        pass
    print("\n가상 Pico 를 종료합니다.")


if __name__ == "__main__":
    main()
