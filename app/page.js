"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";

const TOTAL_SLOTS = 6;

// ══════════════════════════════════════════════════════════
//  MAIN DASHBOARD
// ══════════════════════════════════════════════════════════
export default function Dashboard() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState("placement");
  const [properties, setProperties] = useState([]);
  const [loadingProps, setLoadingProps] = useState(true);
  const [slots, setSlots] = useState(
    Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
      id: i + 1,
      status: "empty",
      property: null,
    }))
  );

  // Browser & automation state
  const [browserFrame, setBrowserFrame] = useState(null);
  const [browserUrl, setBrowserUrl] = useState("");
  const [placementStatus, setPlacementStatus] = useState(null);
  const [bukakuStatus, setBukakuStatus] = useState(null);
  const [isAutomating, setIsAutomating] = useState(false);
  const [automatingPropertyId, setAutomatingPropertyId] = useState(null);
  const [statusLog, setStatusLog] = useState([]);
  const lastActivityRef = useRef(Date.now());

  // ── Watchdog: auto-reset if no activity for 25s ────────
  useEffect(() => {
    if (!isAutomating) return;
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 25000) {
        setIsAutomating(false);
        setAutomatingPropertyId(null);
        setPlacementStatus((prev) =>
          prev?.phase !== "complete"
            ? { phase: "error", message: "応答なし - 自動リセットしました" }
            : prev
        );
      }
    }, 3000);
    return () => clearInterval(watchdog);
  }, [isAutomating]);

  // ── Socket.io ──────────────────────────────────────────
  useEffect(() => {
    const s = io(window.location.origin, { reconnection: true });

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    s.on("browser-frame", (data) => {
      setBrowserFrame(data.image);
      setBrowserUrl(data.url || "");
      lastActivityRef.current = Date.now();
    });

    s.on("slots-update", (data) => setSlots(data));

    s.on("placement-status", (data) => {
      setPlacementStatus(data);
      lastActivityRef.current = Date.now();
      setStatusLog((prev) => [
        { time: new Date(), ...data },
        ...prev.slice(0, 30),
      ]);
      if (data.phase === "complete" || data.phase === "error") {
        setTimeout(() => {
          setIsAutomating(false);
          setAutomatingPropertyId(null);
        }, 3000);
      }
    });

    s.on("bukaku-status", (data) => {
      setBukakuStatus(data);
      lastActivityRef.current = Date.now();
      setStatusLog((prev) => [
        { time: new Date(), type: "bukaku", ...data },
        ...prev.slice(0, 30),
      ]);
      if (
        data.phase === "confirmed" ||
        data.phase === "removed" ||
        data.phase === "error"
      ) {
        setTimeout(() => {
          setIsAutomating(false);
          setBukakuStatus(null);
        }, 3000);
      }
    });

    setSocket(s);
    return () => s.disconnect();
  }, []);

  // ── Fetch properties from Notion ───────────────────────
  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((data) => {
        setProperties(data);
        setLoadingProps(false);
      })
      .catch(() => setLoadingProps(false));
  }, []);

  // ── Actions ────────────────────────────────────────────
  const handleStartPlacement = useCallback(
    (property) => {
      if (!socket || isAutomating) return;
      setIsAutomating(true);
      setAutomatingPropertyId(property.id);
      setBrowserFrame(null);
      setPlacementStatus(null);
      setStatusLog([]);
      socket.emit("start-placement", { property });
    },
    [socket, isAutomating]
  );

  const handleStartBukaku = useCallback(
    (slotId) => {
      if (!socket || isAutomating) return;
      setIsAutomating(true);
      setBrowserFrame(null);
      setBukakuStatus(null);
      socket.emit("start-bukaku", { slotId });
    },
    [socket, isAutomating]
  );

  const handleStartBukakuAll = useCallback(() => {
    if (!socket || isAutomating) return;
    setIsAutomating(true);
    setBrowserFrame(null);
    setBukakuStatus(null);
    socket.emit("start-bukaku-all");
  }, [socket, isAutomating]);

  const handleRemoveAd = useCallback(
    (slotId) => {
      if (!socket) return;
      socket.emit("remove-ad", { slotId });
    },
    [socket]
  );

  const activeSlots = slots.filter((s) => s.status === "active").length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ── */}
      <header className="glass border-b border-[var(--color-border)] px-6 py-4">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center text-xs font-bold">
                F
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight">
                  FANGO <span className="text-white/30 font-normal mx-1">×</span> SUUMO
                </h1>
                <p className="text-[10px] text-white/30 tracking-widest uppercase">
                  AI Ad Manager
                </p>
              </div>
            </div>
          </div>

          {/* Slot Indicator */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {slots.map((slot) => (
                <div
                  key={slot.id}
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                    slot.status === "active"
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <div className="text-xs text-white/40">
              <span className="text-white font-medium">{activeSlots}</span>
              <span className="mx-0.5">/</span>
              <span>{TOTAL_SLOTS}</span>
              <span className="ml-1.5">使用中</span>
            </div>
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
          </div>
        </div>
      </header>

      {/* ── Tab Navigation ── */}
      <nav className="px-6 pt-5 pb-1">
        <div className="max-w-[1440px] mx-auto">
          <div className="relative inline-flex items-center bg-white/[0.03] rounded-xl p-1 border border-white/[0.06]">
            {[
              { key: "placement", label: "新規掲載" },
              { key: "management", label: "掲載管理" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="relative z-10 px-8 py-2.5 rounded-[10px] text-[13px] font-medium"
              >
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-[10px] bg-white/[0.08] border border-white/[0.10] shadow-[0_0_12px_rgba(255,255,255,0.02)]"
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  />
                )}
                <span
                  className={`relative z-10 transition-colors duration-200 ${
                    activeTab === tab.key
                      ? "text-white"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ── Content ── */}
      <main className="flex-1 px-6 py-5">
        <div className="max-w-[1440px] mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === "placement" ? (
              <motion.div
                key="placement"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <PlacementTab
                  properties={properties}
                  loadingProps={loadingProps}
                  slots={slots}
                  browserFrame={browserFrame}
                  browserUrl={browserUrl}
                  placementStatus={placementStatus}
                  isAutomating={isAutomating}
                  automatingPropertyId={automatingPropertyId}
                  statusLog={statusLog}
                  onStartPlacement={handleStartPlacement}
                />
              </motion.div>
            ) : (
              <motion.div
                key="management"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <ManagementTab
                  slots={slots}
                  browserFrame={browserFrame}
                  browserUrl={browserUrl}
                  bukakuStatus={bukakuStatus}
                  isAutomating={isAutomating}
                  onStartBukaku={handleStartBukaku}
                  onStartBukakuAll={handleStartBukakuAll}
                  onRemoveAd={handleRemoveAd}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  ① PLACEMENT TAB
// ══════════════════════════════════════════════════════════
function PlacementTab({
  properties,
  loadingProps,
  slots,
  browserFrame,
  browserUrl,
  placementStatus,
  isAutomating,
  automatingPropertyId,
  statusLog,
  onStartPlacement,
}) {
  const emptySlots = slots.filter((s) => s.status === "empty").length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
      {/* Left: Property List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium text-white/60">
            新着物件
            <span className="ml-2 text-white/30">(Notion連携)</span>
          </h2>
          <span className="text-xs text-white/30">
            空き枠: {emptySlots}/{TOTAL_SLOTS}
          </span>
        </div>

        <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
          {loadingProps ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass rounded-xl p-4 animate-shimmer h-28" />
            ))
          ) : (
            properties.map((prop, idx) => (
              <PropertyCard
                key={prop.id}
                property={prop}
                index={idx}
                isAutomating={isAutomating}
                isCurrentTarget={automatingPropertyId === prop.id}
                emptySlots={emptySlots}
                onStart={onStartPlacement}
              />
            ))
          )}
        </div>
      </div>

      {/* Right: Browser View + Status */}
      <div className="space-y-3">
        <BrowserView
          frame={browserFrame}
          url={browserUrl}
          isAutomating={isAutomating}
          status={placementStatus}
        />
        {statusLog.length > 0 && (
          <StatusLog entries={statusLog} />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  ② MANAGEMENT TAB
// ══════════════════════════════════════════════════════════
function ManagementTab({
  slots,
  browserFrame,
  browserUrl,
  bukakuStatus,
  isAutomating,
  onStartBukaku,
  onStartBukakuAll,
  onRemoveAd,
}) {
  const activeSlots = slots.filter((s) => s.status === "active");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-5">
      {/* Left: Ad Slots */}
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium text-white/60">
            掲載中の広告
            <span className="ml-2 text-white/30">({activeSlots.length}件)</span>
          </h2>
          <button
            onClick={onStartBukakuAll}
            disabled={isAutomating || activeSlots.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-400
                       hover:bg-violet-500/25 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            全件物確を実行
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {slots.map((slot) => (
            <AdSlotCard
              key={slot.id}
              slot={slot}
              bukakuStatus={bukakuStatus}
              isAutomating={isAutomating}
              onStartBukaku={onStartBukaku}
              onRemoveAd={onRemoveAd}
            />
          ))}
        </div>
      </div>

      {/* Right: Browser View for Bukaku */}
      <div>
        <BrowserView
          frame={browserFrame}
          url={browserUrl}
          isAutomating={isAutomating}
          status={
            bukakuStatus
              ? { phase: bukakuStatus.phase, message: bukakuStatus.message }
              : null
          }
        />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  COMPONENTS
// ══════════════════════════════════════════════════════════

// ── Property Card ────────────────────────────────────────
function PropertyCard({
  property,
  index,
  isAutomating,
  isCurrentTarget,
  emptySlots,
  onStart,
}) {
  const p = property;
  const responseLevel =
    p.predictedResponses >= 6.0
      ? "top"
      : p.predictedResponses >= 4.0
        ? "high"
        : "mid";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`glass rounded-xl p-4 glass-hover transition-all duration-200 group ${
        isCurrentTarget ? "glow-accent border-violet-500/30" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Station & Line */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">{p.station}</span>
            <span className="text-xs text-white/30">
              {p.line} 徒歩{p.walk}
            </span>
          </div>

          {/* Details */}
          <div className="flex items-center gap-3 text-xs text-white/50 mb-2.5">
            <span className="font-medium text-white/80">{p.rent}</span>
            <span>{p.area}</span>
            <span>{p.structure}</span>
            <span>{p.age}</span>
          </div>

          {/* Address */}
          <p className="text-[11px] text-white/25 truncate">{p.address}</p>

          {/* Predicted views */}
          <div className="mt-2.5 flex items-center gap-1.5">
            {responseLevel === "top" && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 leading-none mr-0.5">
                HOT
              </span>
            )}
            <span
              className={`text-base font-bold tabular-nums leading-none ${
                responseLevel === "top"
                  ? "text-violet-300"
                  : responseLevel === "high"
                    ? "text-emerald-400"
                    : "text-amber-400"
              }`}
            >
              {p.predictedResponses.toFixed(1)}
            </span>
            <span className="text-[10px] text-white/25 leading-none">
              views/day
            </span>
          </div>
        </div>

        {/* Action */}
        <button
          onClick={() => onStart(p)}
          disabled={isAutomating || emptySlots === 0}
          className={`mt-1 shrink-0 text-xs px-3 py-2 rounded-lg font-medium transition-all duration-200
            ${
              isCurrentTarget
                ? "bg-violet-500 text-white animate-pulse"
                : "bg-white/5 text-white/40 hover:bg-violet-500/20 hover:text-violet-300 group-hover:text-white/60"
            }
            disabled:opacity-20 disabled:cursor-not-allowed`}
        >
          {isCurrentTarget ? "処理中..." : "掲載開始"}
        </button>
      </div>

      {/* REINS ID */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[10px] text-white/15 font-mono">
          REINS {p.reinsId}
        </span>
      </div>
    </motion.div>
  );
}

// ── Browser View ─────────────────────────────────────────
function BrowserView({ frame, url, isAutomating, status }) {
  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Chrome bar */}
      <div className="browser-chrome px-4 py-2.5 flex items-center gap-3 border-b border-white/5">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
        </div>
        <div className="flex-1 mx-2">
          <div className="bg-white/5 rounded-md px-3 py-1 text-[11px] text-white/30 truncate">
            {url || "about:blank"}
          </div>
        </div>
        {isAutomating && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[10px] text-violet-400">AI操作中</span>
          </div>
        )}
      </div>

      {/* Viewport */}
      <div className="relative aspect-[16/10] bg-black/40">
        {frame ? (
          <img
            src={frame}
            alt="Browser"
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-white/3 flex items-center justify-center mb-3">
              <svg
                className="w-6 h-6 text-white/15"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 003 12c0-1.605.42-3.113 1.157-4.418"
                />
              </svg>
            </div>
            <p className="text-xs text-white/20">
              掲載開始ボタンを押すとブラウザが表示されます
            </p>
          </div>
        )}

        {/* Scan line effect during automation */}
        {isAutomating && frame && (
          <div
            className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent"
            style={{ animation: "scan-line 2s linear infinite" }}
          />
        )}
      </div>

      {/* Status bar */}
      {status && (
        <div className="px-4 py-2.5 border-t border-white/5 flex items-center gap-3">
          {status.phase === "complete" ? (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          ) : status.phase === "error" ? (
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          )}
          <span className="text-xs text-white/50">{status.message}</span>
          {status.step && status.total && (
            <span className="ml-auto text-[10px] text-white/20">
              Step {status.step}/{status.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ad Slot Card ─────────────────────────────────────────
function AdSlotCard({
  slot,
  bukakuStatus,
  isAutomating,
  onStartBukaku,
  onRemoveAd,
}) {
  const isActive = slot.status === "active";
  const isBukakuTarget = bukakuStatus?.slotId === slot.id;
  const p = slot.property;

  const bukakuColor =
    slot.bukakuResult === "空室確認済"
      ? "text-emerald-400"
      : slot.bukakuResult === "成約済"
        ? "text-red-400"
        : "text-white/30";

  return (
    <motion.div
      layout
      className={`glass rounded-xl p-4 transition-all duration-300 ${
        isActive ? "" : "opacity-40"
      } ${isBukakuTarget ? "glow-accent border-violet-500/30" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-emerald-400" : "bg-white/10"
            }`}
          />
          <span className="text-xs text-white/40">
            スロット {slot.id}
          </span>
        </div>
        {isActive && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
            掲載中
          </span>
        )}
      </div>

      {isActive && p ? (
        <>
          <div className="mb-2">
            <p className="text-sm font-medium">{p.station}</p>
            <p className="text-xs text-white/40 mt-0.5">
              {p.line} 徒歩{p.walk} | {p.rent}
            </p>
            <p className="text-[11px] text-white/20 mt-0.5 truncate">
              {p.address}
            </p>
          </div>

          {/* Bukaku status */}
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-white/30">物確ステータス</span>
              <span className={`text-[11px] font-medium ${bukakuColor}`}>
                {slot.bukakuResult || "未確認"}
              </span>
            </div>
            {slot.lastBukaku && (
              <p className="text-[10px] text-white/20">
                最終確認:{" "}
                {new Date(slot.lastBukaku).toLocaleString("ja-JP", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onStartBukaku(slot.id)}
              disabled={isAutomating}
              className="flex-1 text-[11px] py-1.5 rounded-lg bg-white/5 text-white/40
                         hover:bg-violet-500/15 hover:text-violet-400 transition-all
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isBukakuTarget ? "確認中..." : "物確実行"}
            </button>
            <button
              onClick={() => onRemoveAd(slot.id)}
              disabled={isAutomating}
              className="flex-1 text-[11px] py-1.5 rounded-lg bg-white/5 text-white/40
                         hover:bg-red-500/15 hover:text-red-400 transition-all
                         disabled:opacity-30 disabled:cursor-not-allowed"
            >
              取り下げ
            </button>
          </div>
        </>
      ) : (
        <div className="py-6 text-center">
          <p className="text-xs text-white/15">空き枠</p>
        </div>
      )}
    </motion.div>
  );
}

// ── Status Log ───────────────────────────────────────────
function StatusLog({ entries }) {
  return (
    <div className="glass rounded-xl p-3 max-h-44 overflow-y-auto">
      <p className="text-[10px] text-white/30 mb-2 uppercase tracking-wider">
        Activity Log
      </p>
      <div className="space-y-1.5">
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className="text-white/15 tabular-nums shrink-0">
              {new Date(e.time).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span
              className={`${
                e.phase === "error"
                  ? "text-red-400/70"
                  : e.phase === "complete" || e.phase === "confirmed"
                    ? "text-emerald-400/70"
                    : "text-white/40"
              }`}
            >
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
