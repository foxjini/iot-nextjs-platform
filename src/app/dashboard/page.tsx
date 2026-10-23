"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cpu,
  Droplets,
  ExternalLink,
  Gauge,
  Home as HomeIcon,
  Info,
  Lightbulb,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Palette,
  Power,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sun,
  Thermometer,
  X,
} from "lucide-react";

type SensorKey =
  | "temperature"
  | "humidity"
  | "light_percent"
  | "cpu_temp"
  | "discomfort";

type SensorData = Record<string, number | null>;

type SwitchState = {
  led_r: boolean;
  led_g: boolean;
  led_b: boolean;
};

type ConnectionStatus = "online" | "offline";

type ToastType = "success" | "error" | "info";

type ToastState = {
  type: ToastType;
  message: string;
};

type ViewKey = "monitor" | "device" | "system";

type SensorDefinition = {
  key: SensorKey;
  label: string;
  unit: string;
  icon: ComponentType<{ className?: string }>;
  max: number;
};

type NavItem = {
  key: ViewKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const SENSORS: SensorDefinition[] = [
  {
    key: "temperature",
    label: "온도",
    unit: "°C",
    icon: Thermometer,
    max: 40,
  },
  {
    key: "humidity",
    label: "습도",
    unit: "%",
    icon: Droplets,
    max: 100,
  },
  {
    key: "light_percent",
    label: "조도",
    unit: "%",
    icon: Sun,
    max: 100,
  },
  {
    key: "cpu_temp",
    label: "칩 온도",
    unit: "°C",
    icon: Cpu,
    max: 100,
  },
  {
    key: "discomfort",
    label: "불쾌지수",
    unit: "",
    icon: Gauge,
    max: 100,
  },
];

const SWITCHES = [
  {
    key: "led_r" as const,
    label: "빨강",
    pin: "GP17",
  },
  {
    key: "led_g" as const,
    label: "초록",
    pin: "GP18",
  },
  {
    key: "led_b" as const,
    label: "파랑",
    pin: "GP19",
  },
];

const NAV_ITEMS: NavItem[] = [
  {
    key: "monitor",
    label: "실시간 모니터",
    icon: Monitor,
  },
  {
    key: "device",
    label: "장치 제어",
    icon: SlidersHorizontal,
  },
  {
    key: "system",
    label: "시스템 설정",
    icon: Settings,
  },
];

const AUTO_LIGHT_ON = 40;

const INITIAL_SWITCHES: SwitchState = {
  led_r: false,
  led_g: false,
  led_b: false,
};

function SensorCard({
  label,
  value,
  unit,
  max,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  unit: string;
  max: number;
  icon: ComponentType<{ className?: string }>;
}) {
  const missing = value === null;

  const percent = missing
    ? 0
    : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300 focus-within:border-slate-400">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>

          <div className="mt-3 flex items-baseline gap-1">
            <span
              className={`font-mono text-4xl font-semibold tracking-tight ${
                missing ? "text-slate-400" : "text-slate-900"
              }`}
            >
              {missing ? "--" : value}
            </span>

            <span className="text-sm text-slate-400">
              {missing ? "값 없음" : unit}
            </span>
          </div>
        </div>

        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            missing
              ? "bg-slate-100 text-slate-400"
              : "bg-slate-50 text-slate-700"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-slate-700 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </article>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {eyebrow}
      </p>

      <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
        {title}
      </h2>

      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [picoIp, setPicoIp] = useState("192.168.0.51");
  const [ipDraft, setIpDraft] = useState("192.168.0.51");

  const [connected, setConnected] =
    useState<ConnectionStatus>("offline");

  const [sensor, setSensor] = useState<SensorData | null>(null);

  const [sw, setSw] =
    useState<SwitchState>(INITIAL_SWITCHES);

  const [autoMode, setAutoMode] = useState(false);
  const [servoAngle, setServoAngle] = useState(90);

  const [activeView, setActiveView] =
    useState<ViewKey>("monitor");

  const [showSideMenu, setShowSideMenu] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const isOnline = connected === "online";

  const connect = () => {
    wsRef.current?.close();

    const ws = new WebSocket(
      `ws://${picoIp}:5000/connect-websocket`
    );

    ws.onopen = () => {
      setConnected("online");

      setToast({
        type: "success",
        message: "장치에 연결되었습니다.",
      });
    };

    ws.onclose = () => {
      setConnected("offline");
    };

    ws.onerror = () => {
      setConnected("offline");

      setToast({
        type: "error",
        message: "장치 연결에 실패했습니다.",
      });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setSensor(data);
      } catch {
        console.warn(
          "잘못된 메시지 형식:",
          event.data
        );
      }
    };

    wsRef.current = ws;
  };

  const disconnect = () => {
    wsRef.current?.close();
    setConnected("offline");

    setToast({
      type: "info",
      message: "장치 연결을 종료했습니다.",
    });
  };

  const sendCommand = (
    next: SwitchState,
    angle: number
  ) => {
    if (
      wsRef.current?.readyState !==
      WebSocket.OPEN
    ) {
      return false;
    }

    const payload: Record<string, number> = {
      servo_angle: angle,
    };

    for (const item of SWITCHES) {
      payload[item.key] = next[item.key] ? 255 : 0;
    }

    wsRef.current.send(
      JSON.stringify(payload)
    );

    return true;
  };

  const sendAndNotify = (
    next: SwitchState,
    angle: number
  ) => {
    const success = sendCommand(next, angle);

    setToast({
      type: success ? "success" : "error",
      message: success
        ? "장치에 명령을 전송했습니다."
        : "장치가 연결되어 있지 않습니다.",
    });
  };

  const toggleSwitch = (
    key: keyof SwitchState,
    value: boolean
  ) => {
    const next = {
      ...sw,
      [key]: value,
    };

    setSw(next);

    sendAndNotify(
      next,
      servoAngle
    );
  };

  const handleViewChange = (
    view: ViewKey
  ) => {
    setActiveView(view);

    // 모바일 Side Menu에서 선택하면 자동으로 닫는다.
    setShowSideMenu(false);
  };

  const handleSaveSettings = () => {
    setPicoIp(ipDraft);

    setToast({
      type: "success",
      message:
        "IP 주소를 저장했습니다. 장치 연결을 다시 실행하세요.",
    });
  };

  const handleResetSettings = () => {
    setIpDraft(picoIp);

    setToast({
      type: "info",
      message: "변경 내용을 취소했습니다.",
    });
  };

  const handleAbout = () => {
    setShowAbout(true);
  };

  useEffect(() => {
    if (!autoMode || !sensor) return;

    const light = sensor.light_percent;

    if (light == null) return;

    const shouldTurnOn =
      light < AUTO_LIGHT_ON;

    if (
      SWITCHES.some(
        (item) =>
          sw[item.key] !== shouldTurnOn
      )
    ) {
      const next: SwitchState = {
        led_r: shouldTurnOn,
        led_g: shouldTurnOn,
        led_b: shouldTurnOn,
      };

      setSw(next);

      sendCommand(
        next,
        servoAngle
      );
    }

    // 자동 모드에서는 sensor 변화에만 반응한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensor, autoMode]);

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent
    ) => {
      if (event.key === "Escape") {
        setShowSideMenu(false);
        setShowAbout(false);
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const activeSensorAlerts = [
    {
      key: "temperature",
      value: sensor?.temperature,
      threshold: 30,
      label: "고온 경고",
    },
    {
      key: "discomfort",
      value: sensor?.discomfort,
      threshold: 80,
      label: "불쾌지수 높음",
    },
  ].filter(
    (item) =>
      item.value != null &&
      item.value >= item.threshold
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* ================================================================
          GNB
          Navbar에서는 Dashboard / Device / System을 제거하고
          About만 배치한다.
         ================================================================ */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setShowSideMenu(true)
              }
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 md:hidden"
              aria-label="사이드 메뉴 열기"
            >
              <Menu className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() =>
                handleViewChange("monitor")
              }
              className="flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-slate-400"
              aria-label="대시보드 홈"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
                <Activity className="h-5 w-5" />
              </div>

              <div className="hidden min-w-0 sm:block">
                <p className="truncate text-sm font-semibold">
                  IoT Dashboard
                </p>
                <p className="truncate text-xs text-slate-400">
                  실시간 장치 관리
                </p>
              </div>
            </button>
          </div>

          {/* Navbar 메뉴
              기존 Dashboard / Device / System 제거
              About만 유지 */}
          <nav
            className="flex items-center gap-1"
            aria-label="Global Navigation"
          >
            <button
              type="button"
              onClick={handleAbout}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <Info className="h-4 w-4" />
              <span>About</span>
            </button>

            <div className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />

            <div
              className="flex items-center gap-2 rounded-lg px-2 py-2"
              aria-label="연결 상태"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isOnline
                    ? "bg-emerald-500"
                    : "bg-slate-300"
                }`}
              />

              <span className="hidden text-xs font-medium text-slate-500 sm:block">
                {isOnline
                  ? "ONLINE"
                  : "OFFLINE"}
              </span>
            </div>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        {/* ================================================================
            Desktop LNB / Side Menu
            Navbar와 중복되지 않도록 화면 기능 탐색을 담당한다.
           ================================================================ */}
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
          <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col p-4">
            <div className="mb-6 px-3 pt-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Navigation
              </p>
              <p className="mt-1 text-sm text-slate-500">
                화면 선택
              </p>
            </div>

            <nav
              className="space-y-1"
              aria-label="Local Navigation"
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  activeView === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      handleViewChange(
                        item.key
                      )
                    }
                    className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                    aria-current={
                      active
                        ? "page"
                        : undefined
                    }
                  >
                    <Icon className="h-5 w-5 shrink-0" />

                    <span>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-slate-100 pt-4">
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2">
                  <Power
                    className={`h-4 w-4 ${
                      isOnline
                        ? "text-emerald-600"
                        : "text-slate-400"
                    }`}
                  />

                  <span className="text-xs font-medium text-slate-600">
                    장치 상태
                  </span>
                </div>

                <p className="mt-2 font-mono text-xs text-slate-400">
                  {picoIp}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* ================================================================
            Main Content
           ================================================================ */}
        <main className="min-w-0 flex-1">
          <div className="px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
            {/* Breadcrumb */}
            <div className="mb-6 flex items-center gap-2 text-xs text-slate-400">
              <HomeIcon className="h-3.5 w-3.5" />

              <span>Dashboard</span>

              <ChevronRight className="h-3.5 w-3.5" />

              <span className="font-medium text-slate-600">
                {
                  NAV_ITEMS.find(
                    (item) =>
                      item.key ===
                      activeView
                  )?.label
                }
              </span>
            </div>

            {/* ============================================================
                Monitor
               ============================================================ */}
            {activeView === "monitor" && (
              <section>
                <SectionTitle
                  eyebrow="Monitor"
                  title="실시간 모니터"
                  description="Pico 2 W에서 전달되는 센서 데이터를 실시간으로 확인합니다."
                />

                {/* 상단 상태 영역 */}
                <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="border-b border-slate-200 pb-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-500">
                          장치 연결 상태
                        </p>

                        <div className="mt-2 flex items-center gap-3">
                          <span
                            className={`h-3 w-3 rounded-full ${
                              isOnline
                                ? "bg-emerald-500"
                                : "bg-slate-300"
                            }`}
                          />

                          <span className="text-lg font-semibold">
                            {isOnline
                              ? "연결됨"
                              : "연결 안 됨"}
                          </span>
                        </div>

                        <p className="mt-1 font-mono text-xs text-slate-400">
                          ws://{picoIp}:5000/connect-websocket
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={
                          isOnline
                            ? disconnect
                            : connect
                        }
                        className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                          isOnline
                            ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            : "bg-slate-900 text-white hover:bg-slate-800"
                        }`}
                      >
                        {isOnline
                          ? "연결 끊기"
                          : "장치 연결"}
                      </button>
                    </div>
                  </div>

                  <div className="border-b border-slate-200 pb-5 lg:min-w-48">
                    <p className="text-sm font-medium text-slate-500">
                      현재 모드
                    </p>

                    <p className="mt-2 text-lg font-semibold">
                      {autoMode
                        ? "자동 제어"
                        : "수동 제어"}
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      조도 기준 {AUTO_LIGHT_ON}%
                    </p>
                  </div>
                </div>

                {/* 경고 */}
                {activeSensorAlerts.length >
                  0 && (
                  <div className="mb-6 space-y-3">
                    {activeSensorAlerts.map(
                      (alert) => (
                        <div
                          key={alert.key}
                          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                          role="alert"
                        >
                          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />

                          <div>
                            <p className="text-sm font-semibold text-amber-900">
                              {alert.label}
                            </p>

                            <p className="text-xs text-amber-700">
                              현재 값{" "}
                              {alert.value}
                              {alert.key ===
                                "temperature" &&
                                "°C"}
                            </p>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}

                {/* 센서 Grid */}
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {SENSORS.map(
                    (item) => (
                      <SensorCard
                        key={item.key}
                        label={item.label}
                        value={
                          sensor?.[
                            item.key
                          ] ?? null
                        }
                        unit={item.unit}
                        max={item.max}
                        icon={item.icon}
                      />
                    )
                  )}
                </div>
              </section>
            )}

            {/* ============================================================
                Device
               ============================================================ */}
            {activeView === "device" && (
              <section>
                <SectionTitle
                  eyebrow="Device"
                  title="장치 제어"
                  description="RGB LED와 서보모터를 직접 제어합니다."
                />

                <div className="grid gap-6 xl:grid-cols-2">
                  {/* RGB */}
                  <div className="border-b border-slate-200 pb-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">
                          RGB LED
                        </h3>

                        <p className="mt-1 text-sm text-slate-500">
                          개별 색상을 켜거나 끕니다.
                        </p>
                      </div>

                      <Lightbulb className="h-5 w-5 text-slate-400" />
                    </div>

                    <div className="mt-6 space-y-3">
                      {SWITCHES.map(
                        (item) => {
                          const checked =
                            sw[item.key];

                          return (
                            <button
                              key={
                                item.key
                              }
                              type="button"
                              onClick={() =>
                                toggleSwitch(
                                  item.key,
                                  !checked
                                )
                              }
                              disabled={
                                autoMode
                              }
                              className={`flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50 ${
                                checked
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              aria-pressed={
                                checked
                              }
                            >
                              <span>
                                <span className="block text-sm font-semibold">
                                  {
                                    item.label
                                  }
                                </span>

                                <span
                                  className={`mt-0.5 block text-xs ${
                                    checked
                                      ? "text-slate-300"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {
                                    item.pin
                                  }
                                </span>
                              </span>

                              <span
                                className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
                                  checked
                                    ? "bg-white/30"
                                    : "bg-slate-200"
                                }`}
                              >
                                <span
                                  className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                                    checked
                                      ? "translate-x-4"
                                      : "translate-x-0"
                                  }`}
                                />
                              </span>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>

                  {/* Servo */}
                  <div className="border-b border-slate-200 pb-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">
                          서보모터
                        </h3>

                        <p className="mt-1 text-sm text-slate-500">
                          0° ~ 180° 범위로 제어합니다.
                        </p>
                      </div>

                      <RotateCcw className="h-5 w-5 text-slate-400" />
                    </div>

                    <div className="mt-8">
                      <div className="flex items-end justify-between">
                        <span className="text-sm text-slate-500">
                          현재 각도
                        </span>

                        <span className="font-mono text-3xl font-semibold">
                          {servoAngle}°
                        </span>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={180}
                        value={servoAngle}
                        onChange={(event) =>
                          setServoAngle(
                            Number(
                              event.target
                                .value
                            )
                          )
                        }
                        className="mt-6 w-full accent-slate-900"
                        aria-label="서보모터 각도"
                      />

                      <div className="mt-2 flex justify-between text-xs text-slate-400">
                        <span>0°</span>
                        <span>90°</span>
                        <span>180°</span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          sendAndNotify(
                            sw,
                            servoAngle
                          )
                        }
                        disabled={!isOnline}
                        className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        설정 반영
                      </button>
                    </div>
                  </div>
                </div>

                {/* 자동 모드 */}
                <div className="mt-6 border-y border-slate-200 py-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">
                        자동 조명 모드
                      </h3>

                      <p className="mt-1 text-sm text-slate-500">
                        조도가 {AUTO_LIGHT_ON}%
                        미만이면 RGB LED를 자동으로 켭니다.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setAutoMode(
                          !autoMode
                        )
                      }
                      className={`relative h-7 w-12 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                        autoMode
                          ? "bg-slate-900"
                          : "bg-slate-300"
                      }`}
                      role="switch"
                      aria-checked={
                        autoMode
                      }
                      aria-label="자동 조명 모드"
                    >
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                          autoMode
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ============================================================
                System
               ============================================================ */}
            {activeView === "system" && (
              <section>
                <SectionTitle
                  eyebrow="System"
                  title="시스템 설정"
                  description="Pico 2 W 연결 정보를 설정합니다."
                />

                <div className="max-w-2xl border-y border-slate-200 py-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                      <Settings className="h-5 w-5 text-slate-600" />
                    </div>

                    <div>
                      <h3 className="font-semibold">
                        Pico 2 W 연결 설정
                      </h3>

                      <p className="mt-1 text-sm text-slate-500">
                        WebSocket 연결에 사용할 Pico IP 주소를 입력합니다.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6">
                    <label
                      htmlFor="pico-ip"
                      className="mb-2 block text-sm font-medium text-slate-700"
                    >
                      Pico IP 주소
                    </label>

                    <input
                      id="pico-ip"
                      type="text"
                      value={ipDraft}
                      onChange={(event) =>
                        setIpDraft(
                          event.target.value
                        )
                      }
                      placeholder="192.168.0.51"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    />

                    <p className="mt-2 text-xs text-slate-400">
                      현재 저장된 주소:{" "}
                      {picoIp}
                    </p>
                  </div>

                  <div className="mt-6 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={
                        handleResetSettings
                      }
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    >
                      취소
                    </button>

                    <button
                      type="button"
                      onClick={
                        handleSaveSettings
                      }
                      className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    >
                      저장
                    </button>
                  </div>
                </div>

                <div className="mt-6 max-w-2xl border-y border-slate-200 py-6">
                  <div className="flex items-center gap-3">
                    <Activity className="h-5 w-5 text-slate-500" />

                    <div>
                      <p className="text-sm font-semibold">
                        WebSocket 상태
                      </p>

                      <p className="mt-1 text-xs text-slate-400">
                        ws://{picoIp}:5000/connect-websocket
                      </p>
                    </div>

                    <span
                      className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
                        isOnline
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {isOnline
                        ? "ONLINE"
                        : "OFFLINE"}
                    </span>
                  </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      {/* ================================================================
          Mobile Side Menu
         ================================================================ */}
      {showSideMenu && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() =>
              setShowSideMenu(false)
            }
            aria-label="사이드 메뉴 닫기"
          />

          <aside className="relative flex h-full w-80 max-w-[85vw] flex-col bg-white shadow-lg">
            <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
              <div>
                <p className="text-sm font-semibold">
                  Navigation
                </p>

                <p className="text-xs text-slate-400">
                  화면 선택
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowSideMenu(false)
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                aria-label="사이드 메뉴 닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav
              className="flex-1 space-y-1 p-4"
              aria-label="Mobile Local Navigation"
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  activeView === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() =>
                      handleViewChange(
                        item.key
                      )
                    }
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                      active
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                    aria-current={
                      active
                        ? "page"
                        : undefined
                    }
                  >
                    <Icon className="h-5 w-5" />

                    <span>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="border-t border-slate-100 p-4">
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOnline
                        ? "bg-emerald-500"
                        : "bg-slate-300"
                    }`}
                  />

                  <span className="text-sm font-medium text-slate-600">
                    {isOnline
                      ? "장치 연결됨"
                      : "장치 연결 안 됨"}
                  </span>
                </div>

                <p className="mt-2 font-mono text-xs text-slate-400">
                  {picoIp}
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ================================================================
          About Modal
          About은 Navbar에서만 접근한다.
         ================================================================ */}
      {showAbout && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() =>
              setShowAbout(false)
            }
            aria-label="About 닫기"
          />

          <section
            className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                  <CircleHelp className="h-5 w-5 text-slate-600" />
                </div>

                <div>
                  <h2
                    id="about-title"
                    className="font-semibold"
                  >
                    About
                  </h2>

                  <p className="text-xs text-slate-400">
                    IoT 실시간 대시보드
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowAbout(false)
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                aria-label="About 닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 space-y-4 text-sm leading-6 text-slate-600">
              <p>
                Raspberry Pi Pico 2 W가 센서 데이터를 측정하고
                WebSocket을 통해 이 대시보드로 전달합니다.
              </p>

              <p>
                온도, 습도, 조도, 칩 온도,
                불쾌지수를 실시간으로 확인하고
                RGB LED와 서보모터를 제어할 수 있습니다.
              </p>

              <div className="border-t border-slate-100 pt-4">
                <p className="font-semibold text-slate-800">
                  주요 기술
                </p>

                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  <li>• Next.js + TypeScript</li>
                  <li>• Tailwind CSS</li>
                  <li>• Lucide React</li>
                  <li>• WebSocket</li>
                  <li>• Raspberry Pi Pico 2 W</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() =>
                  setShowAbout(false)
                }
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ================================================================
          Toast
         ================================================================ */}
      {toast && (
        <div
          className="fixed bottom-20 right-4 z-[70] w-[calc(100vw-2rem)] max-w-sm"
          role="status"
          aria-live="polite"
        >
          <div
            className={`flex items-start gap-3 rounded-lg border bg-white p-4 shadow-md ${
              toast.type === "success"
                ? "border-emerald-200"
                : toast.type === "error"
                  ? "border-rose-200"
                  : "border-slate-200"
            }`}
          >
            <div
              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                toast.type === "success"
                  ? "bg-emerald-500"
                  : toast.type === "error"
                    ? "bg-rose-500"
                    : "bg-slate-400"
              }`}
            />

            <p className="flex-1 text-sm text-slate-700">
              {toast.message}
            </p>

            <button
              type="button"
              onClick={() =>
                setToast(null)
              }
              className="text-slate-400 hover:text-slate-700 focus:outline-none"
              aria-label="알림 닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ================================================================
          Footer / Rudder
         ================================================================ */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-xs text-slate-400">
            IoT Dashboard
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setActiveView("monitor")
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
              aria-label="첫 화면"
            >
              <HomeIcon className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveView("system")
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
              aria-label="시스템 설정"
            >
              <Settings className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveView("device")
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
              aria-label="장치 제어"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}