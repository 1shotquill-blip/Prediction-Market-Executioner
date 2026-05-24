import { useMemo, useState } from "react";
import type React from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  CircleStop,
  Copy,
  Gauge,
  History,
  LayoutDashboard,
  Pause,
  Play,
  RadioTower,
  RefreshCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Wallet,
  XCircle,
} from "lucide-react";

const ORANGE = "#FF6B35";

type DashboardData = inferRouterOutputs<AppRouter>["operator"]["dashboard"];
type ActiveLine = DashboardData["activeLines"][number];

type NavTab = "overview" | "orders" | "trades" | "scanner" | "arbitrage" | "settings";

const NAV_ITEMS: { id: NavTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "orders", label: "Open Orders", icon: Gauge },
  { id: "trades", label: "Trade History", icon: History },
  { id: "scanner", label: "Market Scanner", icon: Search },
  { id: "arbitrage", label: "Arbitrage", icon: ArrowLeftRight },
  { id: "settings", label: "Settings", icon: Settings },
];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function usd(value: unknown) {
  const number = Number(value ?? 0);
  return money.format(Number.isFinite(number) ? number : 0);
}

function pct(value: unknown) {
  const number = Number(value ?? 0);
  return `${(Number.isFinite(number) ? number : 0).toFixed(2)}%`;
}

function compact(value?: string | null, head = 6, tail = 4) {
  if (!value) return "UNAVAILABLE";
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border-white/10 bg-white/5 text-white shadow-2xl shadow-black/20 backdrop-blur-md ${className}`}>
      {children}
    </Card>
  );
}

type HybridBreakdown = {
  llmProbabilityConfidence: number;
  deepEdgeAnomaly: number;
  marketSelection: number;
  liquidity: number;
  volumeVelocity: number;
  consensusDivergence: number;
  recencyPenalty: number;
  socialSignal: number;
  socialTweetCount: number;
  socialTopTweets: Array<{ snippet: string; engagement: number }>;
};

const HYBRID_WEIGHTS: Record<string, number> = {
  llmProbabilityConfidence: 0.20,
  deepEdgeAnomaly: 0.18,
  marketSelection: 0.18,
  liquidity: 0.10,
  volumeVelocity: 0.10,
  consensusDivergence: 0.10,
  socialSignal: 0.10,
  recencyPenalty: 0.04,
};

const SIGNAL_LABELS: Record<string, string> = {
  llmProbabilityConfidence: "LLM confidence",
  deepEdgeAnomaly: "Deep edge anomaly",
  marketSelection: "Market selection",
  liquidity: "Liquidity",
  volumeVelocity: "Volume velocity",
  consensusDivergence: "Consensus divergence",
  recencyPenalty: "Recency",
  socialSignal: "Social signal",
};

function ConfidenceMeter({
  score,
  breakdown,
}: {
  score: number;
  breakdown: HybridBreakdown;
}) {
  const clamped = Math.max(0, Math.min(100, score || 0));
  const scoreSignals = Object.keys(HYBRID_WEIGHTS) as Array<keyof typeof HYBRID_WEIGHTS>;

  return (
    <div className="group relative h-5 min-w-36 overflow-visible rounded border border-white/10 bg-black/40">
      <div
        className={`h-full rounded ${clamped > 85 ? "animate-pulse" : ""}`}
        style={{
          width: `${clamped}%`,
          background: "linear-gradient(90deg,#ef4444 0%,#f59e0b 52%,#22c55e 100%)",
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-bold text-white drop-shadow">
        {clamped.toFixed(2)}
      </div>
      <div className="pointer-events-none absolute right-0 top-7 z-30 hidden w-80 rounded border border-white/10 bg-[#111118] p-3 text-xs text-zinc-200 shadow-2xl group-hover:block">
        {scoreSignals.map(key => {
          const raw = Number((breakdown as Record<string, unknown>)[key] ?? 0);
          const weight = HYBRID_WEIGHTS[key] ?? 0;
          const contrib = raw * weight * 100;
          return (
            <div key={key} className="mb-1 flex items-center justify-between gap-2">
              <span className="text-zinc-400">{SIGNAL_LABELS[key] ?? key}</span>
              <span className="flex gap-2 font-mono">
                <span className="w-10 text-right text-zinc-300">{(raw * 100).toFixed(1)}</span>
                <span className="w-6 text-right text-zinc-600">×{(weight * 100).toFixed(0)}%</span>
                <span className="w-8 text-right text-[#FF6B35]">{contrib.toFixed(1)}</span>
              </span>
            </div>
          );
        })}
        {breakdown.socialTweetCount > 0 && (
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="mb-1 text-zinc-500">
              Social: {breakdown.socialTweetCount} tweet{breakdown.socialTweetCount !== 1 ? "s" : ""} · score {(breakdown.socialSignal * 100).toFixed(1)}
            </div>
            {breakdown.socialTopTweets.map((t, i) => (
              <div key={i} className="mb-0.5 truncate text-zinc-400">
                <span className="mr-1 text-zinc-600">#{i + 1}</span>
                <span className="text-amber-400/80">eng={t.engagement.toFixed(0)}</span>
                {" "}{t.snippet}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-28">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix = "",
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-3 rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs uppercase tracking-[0.16em] text-zinc-400">{label}</Label>
        <Input
          className="h-8 w-24 border-white/10 bg-black/40 text-right font-mono text-white"
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onChange(Number(event.target.value))}
        />
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={next => onChange(next[0] ?? value)}
        className="[&_[data-slot=slider-range]]:bg-[#FF6B35]"
      />
      <div className="font-mono text-[11px] text-zinc-500">
        {min}{suffix} / {max}{suffix}
      </div>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  activeTab,
  onTabChange,
  data,
  collapsed,
  onToggle,
}: {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  data: DashboardData | undefined;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const isRunning = data?.status.isRunning;
  const isPaused = data?.status.isPaused;
  const mode = data?.status.executionMode ?? "paper";

  return (
    <aside
      className={`fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-white/10 bg-[#07070D]/95 backdrop-blur-xl transition-all duration-200 ${collapsed ? "w-14" : "w-52"}`}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-white/10 px-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <RadioTower className="size-4 shrink-0 text-[#FF6B35]" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Poly Shore</span>
          </div>
        )}
        {collapsed && <RadioTower className="mx-auto size-4 text-[#FF6B35]" />}
        <button
          onClick={onToggle}
          className="ml-auto rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-white"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>
      </div>

      {/* Status */}
      <div className="border-b border-white/10 p-3 space-y-2">
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          <span className={`size-2 shrink-0 rounded-full ${isRunning && !isPaused ? "bg-emerald-400 animate-pulse" : isPaused ? "bg-amber-400" : "bg-red-500"}`} />
          {!collapsed && (
            <span className="text-xs text-zinc-300">
              {isPaused ? "PAUSED" : isRunning ? "RUNNING" : "HALTED"}
            </span>
          )}
        </div>
        {!collapsed && (
          <>
            <Badge className={mode === "live" ? "border-[#FF6B35]/60 bg-[#FF6B35]/20 text-[#FFB199] text-[10px]" : "bg-zinc-700/60 text-zinc-300 text-[10px]"}>
              {mode.toUpperCase()} MODE
            </Badge>
            <div className="grid grid-cols-1 gap-1.5 pt-1">
              <div className="text-[10px] text-zinc-500 uppercase tracking-[0.14em]">Bankroll</div>
              <div className="font-mono text-sm text-white">{usd(data?.bankrolls.polymarketUsdc)}</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-[0.14em]">Today P&L</div>
              <div className={`font-mono text-sm ${(data?.pnl.todayUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {usd(data?.pnl.todayUsd)}
              </div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-[0.14em]">Current Drawdown</div>
              <div className="font-mono text-sm text-red-300">
                {usd(data?.pnl.currentDrawdownUsd)} ({pct(data?.pnl.currentDrawdownPct)})
              </div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-[0.14em]">All-Time P&L</div>
              <div className={`font-mono text-sm ${(data?.pnl.allTimeUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {usd(data?.pnl.allTimeUsd)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex w-full items-center gap-3 rounded px-2 py-2 text-left text-xs transition-colors ${
                activeTab === item.id
                  ? "bg-[#FF6B35]/20 text-[#FF6B35]"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              } ${collapsed ? "justify-center" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="uppercase tracking-[0.12em]">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

// ─── Bot Controls ─────────────────────────────────────────────────────────────

function BotControls({ data, onRefresh }: { data: DashboardData | undefined; onRefresh: () => void }) {
  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.operator.dashboard.invalidate();
    onRefresh();
  };

  const startBot = trpc.operator.start.useMutation({ onSuccess: invalidate });
  const stopBot = trpc.operator.stop.useMutation({ onSuccess: invalidate });
  const pauseBot = trpc.operator.pause.useMutation({ onSuccess: invalidate });
  const resumeBot = trpc.operator.resume.useMutation({ onSuccess: invalidate });
  const emergencyStop = trpc.operator.emergencyStop.useMutation({ onSuccess: invalidate });
  const [confirmStop, setConfirmStop] = useState(false);

  const isRunning = data?.status.isRunning;
  const isPaused = data?.status.isPaused;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={isRunning && !isPaused}
          onClick={() => isRunning && isPaused ? resumeBot.mutate() : startBot.mutate()}
        >
          <Play className="mr-1.5 size-3.5" />
          {isRunning && isPaused ? "Resume" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-white/10 bg-white/5 disabled:opacity-50"
          disabled={!isRunning || isPaused}
          onClick={() => pauseBot.mutate()}
        >
          <Pause className="mr-1.5 size-3.5" />
          Pause
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-white/10 bg-white/5 disabled:opacity-50"
          disabled={!isRunning}
          onClick={() => stopBot.mutate()}
        >
          <CircleStop className="mr-1.5 size-3.5" />
          Stop
        </Button>
        <Button
          size="sm"
          className="bg-red-600 text-white hover:bg-red-500"
          onClick={() => setConfirmStop(true)}
        >
          <Ban className="mr-1.5 size-3.5" />
          Emergency Stop
        </Button>
      </div>

      <Dialog open={confirmStop} onOpenChange={setConfirmStop}>
        <DialogContent className="border-white/10 bg-[#111118] text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400">Emergency Stop</DialogTitle>
            <DialogDescription>This will immediately halt all trading and cancel all open orders. Confirm?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-white/10 bg-white/5" onClick={() => setConfirmStop(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-500" onClick={() => { emergencyStop.mutate(); setConfirmStop(false); }}>Confirm Emergency Stop</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data, onRefresh }: { data: DashboardData | undefined; onRefresh: () => void }) {
  const [perfRange, setPerfRange] = useState("24h");
  const [selectedLine, setSelectedLine] = useState<ActiveLine | null>(null);
  const utils = trpc.useUtils();
  const cancelOrder = trpc.operator.cancelOrder.useMutation({
    onSuccess: () => { utils.operator.dashboard.invalidate(); onRefresh(); },
  });

  const equity = useMemo(() => {
    const all = data?.performance.equity ?? [];
    return all.map(row => ({
      timestamp: new Date(row.timestamp).toLocaleDateString(),
      balance: Number(row.balance),
      pnl: Number(row.balance) - Number(row.peakBalance),
      drawdown: Number(row.drawdown),
    }));
  }, [data]);

  const dailyBars = useMemo(
    () => equity.map((row, index) => ({
      ...row,
      daily: index === 0 ? 0 : row.balance - equity[index - 1].balance,
    })),
    [equity]
  );

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Bankroll", value: usd(data?.bankrolls.polymarketUsdc) },
          { label: "Peak Bankroll", value: usd(data?.bankrolls.peakBankrollUsdc) },
          { label: "Today P&L", value: `${usd(data?.pnl.todayUsd)} / ${pct(data?.pnl.todayPct)}`, tone: (data?.pnl.todayUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300" },
          { label: "Current Drawdown", value: `${usd(data?.pnl.currentDrawdownUsd)} / ${pct(data?.pnl.currentDrawdownPct)}`, tone: "text-red-300" },
        ].map(item => (
          <GlassCard key={item.label}>
            <CardContent className="p-4">
              <Metric label={item.label} value={item.value} tone={item.tone} />
            </CardContent>
          </GlassCard>
        ))}
      </div>

      {/* Performance charts */}
      <GlassCard>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Performance</CardTitle>
          <div className="flex gap-2">
            {["24h", "7d", "30d", "all"].map(range => (
              <Button key={range} size="sm" variant="outline" className={`border-white/10 h-7 text-xs ${perfRange === range ? "bg-[#FF6B35] text-black border-transparent" : "bg-white/5"}`} onClick={() => setPerfRange(range)}>{range}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={equity}>
                  <defs>
                    <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={ORANGE} stopOpacity={0.45} />
                      <stop offset="95%" stopColor={ORANGE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,.08)" />
                  <XAxis dataKey="timestamp" stroke="#71717a" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#71717a" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#111118", border: "1px solid rgba(255,255,255,.1)", fontSize: 11 }} />
                  <Area dataKey="balance" stroke={ORANGE} fill="url(#equityFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={dailyBars}>
                  <CartesianGrid stroke="rgba(255,255,255,.08)" />
                  <XAxis dataKey="timestamp" stroke="#71717a" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#71717a" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#111118", border: "1px solid rgba(255,255,255,.1)", fontSize: 11 }} />
                  <Bar dataKey="daily" fill={ORANGE} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Audits" value={String(data?.performance.audits.length ?? 0)} />
            <Metric label="Trades" value={String(data?.performance.trades.length ?? 0)} />
            <Metric label="Open Positions" value={String(data?.activeLines.length ?? 0)} />
            <Metric label="Closed Lines" value={String(data?.closedLines.length ?? 0)} />
          </div>
        </CardContent>
      </GlassCard>

      {/* Active Lines */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-[#FF6B35]" /> Active Lines
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  {["Exchange", "Market", "Side", "Entry", "Bid/Ask", "Size", "uP&L", "Hybrid", "Resolve", "Status", "Actions"].map(head => (
                    <TableHead key={head} className="text-xs">{head}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.activeLines ?? []).map(line => (
                  <TableRow key={line.nonce} className="border-white/10 hover:bg-white/5">
                    <TableCell>
                      <Badge className={line.exchange === "kalshi" ? "bg-sky-500/20 text-sky-200" : "bg-[#FF6B35]/20 text-[#FFB199]"}>
                        {line.exchange}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-60 truncate text-xs">{line.question}</TableCell>
                    <TableCell>
                      <Badge className={line.side === "buy" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}>
                        {line.side === "buy" ? "YES" : "NO"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{Number(line.price).toFixed(4)}</TableCell>
                    <TableCell className="font-mono text-xs">{line.currentBestBid?.toFixed(3) ?? "--"} / {line.currentBestAsk?.toFixed(3) ?? "--"}</TableCell>
                    <TableCell className="text-xs">{usd(line.size)}</TableCell>
                    <TableCell className={(line.unrealizedPnlUsd ?? 0) >= 0 ? "text-emerald-300 text-xs" : "text-red-300 text-xs"}>{usd(line.unrealizedPnlUsd)}</TableCell>
                    <TableCell><ConfidenceMeter score={line.hybrid.score} breakdown={line.hybrid.breakdown} /></TableCell>
                    <TableCell className="text-xs">{line.expiresAt ? new Date(line.expiresAt).toLocaleDateString() : "--"}</TableCell>
                    <TableCell className="text-xs">{String(line.status).toUpperCase()}</TableCell>
                    <TableCell className="space-x-1">
                      <Button size="sm" variant="outline" className="h-7 border-white/10 bg-white/5 text-xs" onClick={() => setSelectedLine(line)}>View</Button>
                      <Button size="sm" className="h-7 bg-red-600 hover:bg-red-500 text-xs" onClick={() => cancelOrder.mutate({ nonce: line.nonce })}>Cancel</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.activeLines.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={11} className="py-8 text-center text-zinc-500">No open positions or pending orders.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </GlassCard>

      {/* Reasoning trail sheet */}
      <Sheet open={Boolean(selectedLine)} onOpenChange={open => !open && setSelectedLine(null)}>
        <SheetContent className="w-full border-white/10 bg-[#07070D] text-white sm:max-w-2xl">
          <SheetHeader><SheetTitle>Reasoning Trail</SheetTitle></SheetHeader>
          <div className="overflow-auto p-4">
            <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300">
              {JSON.stringify(selectedLine?.reasoning ?? {}, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Open Orders Tab ──────────────────────────────────────────────────────────

function OpenOrdersTab({ data, onRefresh }: { data: DashboardData | undefined; onRefresh: () => void }) {
  const utils = trpc.useUtils();
  const cancelOrder = trpc.operator.cancelOrder.useMutation({
    onSuccess: () => { utils.operator.dashboard.invalidate(); onRefresh(); },
  });
  const [selectedLine, setSelectedLine] = useState<ActiveLine | null>(null);

  return (
    <>
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-[#FF6B35]" /> Open Orders
            <Badge className="ml-2 bg-white/10 text-zinc-300">{data?.activeLines.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  {["Market ID", "Question", "Side", "Price", "Size", "Matched", "Status", "Placed At", "Expires", "Actions"].map(h => (
                    <TableHead key={h} className="text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.activeLines ?? []).map(line => (
                  <TableRow key={line.nonce} className="border-white/10 hover:bg-white/5">
                    <TableCell className="font-mono text-xs text-zinc-400">{compact(line.marketId, 8, 6)}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs">{line.question}</TableCell>
                    <TableCell>
                      <Badge className={line.side === "buy" ? "bg-emerald-500/20 text-emerald-300 text-[10px]" : "bg-red-500/20 text-red-300 text-[10px]"}>
                        {line.side === "buy" ? "BUY / YES" : "SELL / NO"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{Number(line.price).toFixed(4)}</TableCell>
                    <TableCell className="text-xs">{usd(line.size)}</TableCell>
                    <TableCell className="font-mono text-xs">{Number(line.matchedSize ?? 0).toFixed(4)}</TableCell>
                    <TableCell>
                      <Badge className="bg-white/10 text-zinc-300 text-[10px]">{String(line.lifecycleState ?? line.status).replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-400">{new Date(line.placedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{line.expiresAt ? new Date(line.expiresAt).toLocaleString() : "--"}</TableCell>
                    <TableCell className="space-x-1">
                      <Button size="sm" variant="outline" className="h-7 border-white/10 bg-white/5 text-xs" onClick={() => setSelectedLine(line)}>Details</Button>
                      <Button size="sm" className="h-7 bg-red-600 hover:bg-red-500 text-xs" onClick={() => cancelOrder.mutate({ nonce: line.nonce })}>Cancel</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.activeLines.length ?? 0) === 0 && (
                  <TableRow><TableCell colSpan={10} className="py-12 text-center text-zinc-500">No open orders.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </GlassCard>

      <Sheet open={Boolean(selectedLine)} onOpenChange={open => !open && setSelectedLine(null)}>
        <SheetContent className="w-full border-white/10 bg-[#07070D] text-white sm:max-w-2xl">
          <SheetHeader><SheetTitle>Order Details — Reasoning Trail</SheetTitle></SheetHeader>
          <div className="overflow-auto p-4">
            <pre className="whitespace-pre-wrap rounded border border-white/10 bg-black/40 p-4 text-xs text-zinc-300">
              {JSON.stringify(selectedLine?.reasoning ?? {}, null, 2)}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Trade History Tab ────────────────────────────────────────────────────────

function TradesTab({ data }: { data: DashboardData | undefined }) {
  const [activeSubTab, setActiveSubTab] = useState<"trades" | "audits" | "closed">("trades");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["trades", "audits", "closed"] as const).map(tab => (
          <Button key={tab} size="sm" variant="outline" className={`border-white/10 capitalize ${activeSubTab === tab ? "bg-[#FF6B35] text-black border-transparent" : "bg-white/5"}`} onClick={() => setActiveSubTab(tab)}>
            {tab === "audits" ? "Decision Audits" : tab === "closed" ? "Closed Lines" : "Recent Trades"}
          </Button>
        ))}
      </div>

      {activeSubTab === "trades" && (
        <GlassCard>
          <CardHeader>
            <CardTitle className="text-base">Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    {["Market", "Side", "Fill Price", "Fill Size", "Value", "Edge", "Confidence", "P&L", "Executed At"].map(h => (
                      <TableHead key={h} className="text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.performance.trades ?? []).map(trade => (
                    <TableRow key={trade.id} className="border-white/10">
                      <TableCell className="font-mono text-xs text-zinc-400">{compact(trade.marketId, 8, 6)}</TableCell>
                      <TableCell>
                        <Badge className={trade.side === "buy" ? "bg-emerald-500/20 text-emerald-300 text-[10px]" : "bg-red-500/20 text-red-300 text-[10px]"}>
                          {trade.side.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{Number(trade.price).toFixed(4)}</TableCell>
                      <TableCell className="font-mono text-xs">{Number(trade.size).toFixed(4)}</TableCell>
                      <TableCell className="text-xs">{usd(trade.usdcValue)}</TableCell>
                      <TableCell className="font-mono text-xs">{trade.edgeAtTrade != null ? Number(trade.edgeAtTrade).toFixed(4) : "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{trade.confidenceAtTrade != null ? pct(Number(trade.confidenceAtTrade) * 100) : "--"}</TableCell>
                      <TableCell className="text-xs text-zinc-500">--</TableCell>
                      <TableCell className="text-xs text-zinc-400">{new Date(trade.filledAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.performance.trades.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={9} className="py-12 text-center text-zinc-500">No trades recorded yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </GlassCard>
      )}

      {activeSubTab === "audits" && (
        <GlassCard>
          <CardHeader>
            <CardTitle className="text-base">Decision Audits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    {["Market", "Question", "Action", "Est. Prob", "Confidence", "Edge", "Bid", "Ask", "Spread", "Created"].map(h => (
                      <TableHead key={h} className="text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.performance.audits ?? []).map(audit => (
                    <TableRow key={audit.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="font-mono text-xs text-zinc-400">{compact(audit.marketId, 8, 6)}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs">{audit.question}</TableCell>
                      <TableCell>
                        <Badge className={
                          audit.action === "skipped"
                            ? "bg-zinc-700/60 text-zinc-300 text-[10px]"
                            : "bg-emerald-500/20 text-emerald-300 text-[10px]"
                        }>
                          {audit.action.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{audit.estimatedProbability != null ? Number(audit.estimatedProbability).toFixed(4) : "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{audit.confidence != null ? pct(Number(audit.confidence) * 100) : "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{audit.edge != null ? Number(audit.edge).toFixed(4) : "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{audit.bestBid != null ? Number(audit.bestBid).toFixed(3) : "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{audit.bestAsk != null ? Number(audit.bestAsk).toFixed(3) : "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{audit.spread != null ? Number(audit.spread).toFixed(3) : "--"}</TableCell>
                      <TableCell className="text-xs text-zinc-400">{new Date(audit.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.performance.audits.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={10} className="py-12 text-center text-zinc-500">No decision audits yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </GlassCard>
      )}

      {activeSubTab === "closed" && (
        <GlassCard>
          <CardHeader>
            <CardTitle className="text-base">Closed Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10">
                    {["Market", "Final P&L", "Outcome", "Placed", "Closed"].map(h => (
                      <TableHead key={h} className="text-xs">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.closedLines ?? []).map(line => (
                    <TableRow key={line.nonce} className="border-white/10">
                      <TableCell className="font-mono text-xs text-zinc-400">{compact(line.marketId, 12, 8)}</TableCell>
                      <TableCell className={`text-xs ${(line.finalPnlUsd ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{usd(line.finalPnlUsd)} / {pct(line.finalPnlPct)}</TableCell>
                      <TableCell><Badge className="bg-white/10 text-zinc-300 text-[10px]">{line.outcome}</Badge></TableCell>
                      <TableCell className="text-xs text-zinc-400">{new Date(line.placedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-zinc-400">{line.filledAt ? new Date(line.filledAt).toLocaleString() : line.cancelledAt ? new Date(line.cancelledAt).toLocaleString() : "--"}</TableCell>
                    </TableRow>
                  ))}
                  {(data?.closedLines.length ?? 0) === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-12 text-center text-zinc-500">No closed lines yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </GlassCard>
      )}
    </div>
  );
}

// ─── Market Scanner Tab ───────────────────────────────────────────────────────

function ScannerTab({ onRefresh }: { onRefresh: () => void }) {
  const utils = trpc.useUtils();
  const [marketQuery, setMarketQuery] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState<"polymarket" | "kalshi" | "both">("polymarket");
  const [selectedMarket, setSelectedMarket] = useState<any>(null);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [sizeUsd, setSizeUsd] = useState(25);
  const [price, setPrice] = useState(0.5);
  const [confirmOrder, setConfirmOrder] = useState(false);

  const marketSearch = trpc.operator.searchMarkets.useQuery(
    { query: marketQuery, exchange: exchangeFilter, limit: 25 },
    { enabled: marketQuery.trim().length > 1 }
  );
  const runIntel = trpc.operator.runIntelligence.useMutation();
  const submitOrder = trpc.operator.submitOperatorOrder.useMutation({
    onSuccess: () => { utils.operator.dashboard.invalidate(); setConfirmOrder(false); onRefresh(); },
  });

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Search panel */}
        <GlassCard className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="size-4 text-[#FF6B35]" /> Market Search
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              {(["polymarket", "kalshi", "both"] as const).map(exchange => (
                <Button key={exchange} size="sm" variant="outline" className={`border-white/10 text-xs capitalize ${exchangeFilter === exchange ? "bg-[#FF6B35] text-black border-transparent" : "bg-white/5"}`} onClick={() => setExchangeFilter(exchange)}>
                  {exchange}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                className="border-white/10 bg-black/40 text-white"
                placeholder="Search markets by keyword…"
                value={marketQuery}
                onChange={event => setMarketQuery(event.target.value)}
              />
              <Button className="bg-[#FF6B35] text-black shrink-0">
                <Search className="size-4" />
              </Button>
            </div>
            <div className="max-h-96 overflow-auto rounded border border-white/10">
              {marketSearch.isLoading ? (
                <div className="py-8 text-center text-zinc-500 text-sm">Searching…</div>
              ) : marketQuery.trim().length <= 1 ? (
                <div className="py-8 text-center text-zinc-500 text-sm">Type 2+ characters to search</div>
              ) : (marketSearch.data ?? []).length === 0 ? (
                <div className="py-8 text-center text-zinc-500 text-sm">No markets found for "{marketQuery}"</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      {["Question", "Exchange", "Best Bid", "Best Ask", "Spread", "Volume 24h", "Liquidity", "Expires", ""].map(h => (
                        <TableHead key={h} className="text-[10px]">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(marketSearch.data ?? []).map(market => (
                      <TableRow
                        key={market.marketId}
                        className={`border-white/10 cursor-pointer hover:bg-white/5 transition-colors ${selectedMarket?.marketId === market.marketId ? "bg-[#FF6B35]/10" : ""}`}
                        onClick={() => { setSelectedMarket(market); setPrice(market.bestAsk); }}
                      >
                        <TableCell className="max-w-56 truncate text-xs">{market.question}</TableCell>
                        <TableCell>
                          <Badge className={market.exchange === "kalshi" ? "bg-sky-500/20 text-sky-200 text-[10px]" : "bg-[#FF6B35]/20 text-[#FFB199] text-[10px]"}>
                            {market.exchange}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{market.bestBid.toFixed(3)}</TableCell>
                        <TableCell className="font-mono text-xs">{market.bestAsk.toFixed(3)}</TableCell>
                        <TableCell className="font-mono text-xs">{market.spread?.toFixed(3) ?? "--"}</TableCell>
                        <TableCell className="text-xs">{usd(market.volume24h)}</TableCell>
                        <TableCell className="text-xs">{usd(market.liquidity)}</TableCell>
                        <TableCell className="text-xs text-zinc-400">{market.expiresAt ? new Date(market.expiresAt).toLocaleDateString() : "--"}</TableCell>
                        <TableCell>
                          <Button size="sm" className="h-6 bg-[#FF6B35] text-black text-[10px] px-2" onClick={e => { e.stopPropagation(); setSelectedMarket(market); setPrice(market.bestAsk); }}>
                            Select
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </GlassCard>

        {/* Order entry panel */}
        <GlassCard className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Manual Order Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedMarket ? (
              <div className="rounded border border-white/10 bg-black/30 p-3 text-sm">
                <div className="mb-1 text-zinc-400 text-xs uppercase tracking-[0.14em]">Selected Market</div>
                <div className="text-white text-sm leading-snug">{selectedMarket.question}</div>
                <div className="mt-2 flex gap-3 font-mono text-xs text-zinc-500">
                  <span>bid {selectedMarket.bestBid?.toFixed(3)}</span>
                  <span>ask {selectedMarket.bestAsk?.toFixed(3)}</span>
                </div>
              </div>
            ) : (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">
                Select a market from search results
              </div>
            )}

            <div>
              <Label className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-400">Side</Label>
              <div className="flex rounded border border-white/10 p-1">
                {(["yes", "no"] as const).map(next => (
                  <button key={next} className={`flex-1 rounded px-3 py-2 text-sm font-bold transition-colors ${side === next ? "bg-[#FF6B35] text-black" : "text-zinc-400 hover:text-white"}`} onClick={() => setSide(next)}>
                    {next.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-zinc-400">Size (USD)</Label>
                <Input className="border-white/10 bg-black/40 text-white" type="number" value={sizeUsd} onChange={e => setSizeUsd(Number(e.target.value))} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-zinc-400">Limit Price</Label>
                <Input className="border-white/10 bg-black/40 text-white" type="number" min="0.01" max="0.99" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} />
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full border-white/10 bg-white/5"
              disabled={!selectedMarket || runIntel.isPending}
              onClick={() => selectedMarket && runIntel.mutate({ marketId: selectedMarket.marketId, exchange: selectedMarket.exchange, side })}
            >
              <BrainCircuit className="mr-2 size-4" />
              {runIntel.isPending ? "Running intelligence…" : "Run Intelligence"}
            </Button>

            {runIntel.data && (
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <div className="mb-2 text-xs uppercase tracking-[0.14em] text-zinc-500">Hybrid Score</div>
                <ConfidenceMeter score={runIntel.data.hybrid.score} breakdown={runIntel.data.hybrid.breakdown} />
                <div className="mt-3 text-xs text-zinc-400 leading-relaxed">
                  {[...runIntel.data.risk.reasons, ...runIntel.data.deepEdge.reasons].join(" | ") || "Risk manager and DeepEdgeGate allow this pick."}
                </div>
              </div>
            )}

            <Button
              className="w-full bg-[#FF6B35] text-black hover:bg-[#ff875d]"
              disabled={!selectedMarket}
              onClick={() => setConfirmOrder(true)}
            >
              Submit Order
            </Button>

            {submitOrder.data?.vetoed && (
              <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                Vetoed: {(submitOrder.data.reasons ?? []).join(" | ")}
              </div>
            )}
            {submitOrder.data && !submitOrder.data.vetoed && (
              <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                Order submitted successfully.
              </div>
            )}
          </CardContent>
        </GlassCard>
      </div>

      <Dialog open={confirmOrder} onOpenChange={setConfirmOrder}>
        <DialogContent className="border-white/10 bg-[#111118] text-white">
          <DialogHeader>
            <DialogTitle>Submit Paper Order?</DialogTitle>
            <DialogDescription>Risk manager and killswitch gates can still veto this order.</DialogDescription>
          </DialogHeader>
          <div className="rounded border border-white/10 bg-black/30 p-3 text-sm">{selectedMarket?.question}</div>
          <div className="flex gap-4 text-sm">
            <Metric label="Side" value={side.toUpperCase()} />
            <Metric label="Size" value={usd(sizeUsd)} />
            <Metric label="Limit Price" value={price.toFixed(3)} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/10 bg-white/5" onClick={() => setConfirmOrder(false)}>Cancel</Button>
            <Button className="bg-[#FF6B35] text-black" onClick={() => selectedMarket && submitOrder.mutate({ marketId: selectedMarket.marketId, exchange: selectedMarket.exchange, side, sizeUsd, price })}>
              Confirm Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Arbitrage Tab ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source?: string }) {
  if (source === "arbs_xyz") {
    return (
      <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-500/20 text-violet-300 ring-1 ring-inset ring-violet-500/30">
        arbs.xyz
      </span>
    );
  }
  return (
    <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-zinc-700/50 text-zinc-400 ring-1 ring-inset ring-zinc-600/40">
      internal
    </span>
  );
}

function ArbitrageTab({ data, onRefresh }: { data: DashboardData | undefined; onRefresh: () => void }) {
  const utils = trpc.useUtils();
  const [sizeUsd, setSizeUsd] = useState(10);
  const executeArbitrage = trpc.operator.executeArbitragePair.useMutation({
    onSuccess: () => { utils.operator.dashboard.invalidate(); onRefresh(); },
  });

  const arbitrage = data?.arbitrage ?? [];
  const externalCount = arbitrage.filter(p => (p as { source?: string }).source === "arbs_xyz").length;

  return (
    <GlassCard>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowLeftRight className="size-4 text-[#FF6B35]" /> Cross-Exchange Arbitrage
            {externalCount > 0 && (
              <span className="text-xs font-normal text-violet-300">{externalCount} from arbs.xyz</span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <label htmlFor="arb-size" className="whitespace-nowrap">Size USD</label>
            <input
              id="arb-size"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={sizeUsd}
              onChange={e => setSizeUsd(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded border border-white/10 bg-black/40 px-2 py-1 text-right font-mono text-white focus:outline-none focus:ring-1 focus:ring-[#FF6B35]"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-white/10">
              {["Pair", "Source", "Poly YES", "Kalshi NO", "Gap", "Action"].map(h => (
                <TableHead key={h} className="text-xs">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {arbitrage.map(pair => {
              const src = (pair as { source?: string }).source;
              const isExecuting =
                executeArbitrage.isPending &&
                (executeArbitrage.variables as { polymarketId: string })?.polymarketId === pair.polymarket.marketId;
              return (
                <TableRow key={`${pair.polymarket.marketId}-${pair.kalshi.marketId}`} className="border-white/10">
                  <TableCell className="max-w-80 truncate text-xs" title={pair.polymarket.question}>
                    {pair.polymarket.question}
                  </TableCell>
                  <TableCell className="text-xs">
                    <SourceBadge source={src} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{pair.polymarketYesPrice.toFixed(3)}</TableCell>
                  <TableCell className="font-mono text-xs">{pair.kalshiNoPrice.toFixed(3)}</TableCell>
                  <TableCell className="font-mono text-xs text-emerald-300 font-semibold">
                    +{pair.gap.toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      disabled={isExecuting}
                      className="h-7 bg-[#FF6B35] text-black text-xs disabled:opacity-50"
                      onClick={() =>
                        executeArbitrage.mutate({
                          polymarketId: pair.polymarket.marketId,
                          kalshiId: pair.kalshi.marketId,
                          sizeUsd,
                        })
                      }
                    >
                      {isExecuting ? "Placing…" : "Execute"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {arbitrage.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-zinc-500">
                  No cross-exchange arbitrage currently detected.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {executeArbitrage.data && (
          <p className={`mt-3 text-xs ${executeArbitrage.data.partialFailure ? "text-amber-400" : "text-emerald-400"}`}>
            {executeArbitrage.data.partialFailure
              ? `Partial fill — ${executeArbitrage.data.partialFailure}`
              : `Submitted (${executeArbitrage.data.liveMode ? "LIVE" : "paper"})`}
          </p>
        )}
      </CardContent>
    </GlassCard>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ data, onRefresh }: { data: DashboardData | undefined; onRefresh: () => void }) {
  const utils = trpc.useUtils();
  const [localSettings, setLocalSettings] = useState<DashboardData["settings"] | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const editableSettings = localSettings ?? data?.settings;

  const saveSettings = trpc.operator.updateSettings.useMutation({
    onSuccess: () => { utils.operator.dashboard.invalidate(); setConfirmSave(false); onRefresh(); },
  });

  const updateSetting = <K extends keyof DashboardData["settings"]>(key: K, value: DashboardData["settings"][K]) =>
    setLocalSettings(prev => ({ ...(prev ?? data!.settings), [key]: value }));

  const applySettings = () => {
    if (!editableSettings) return;
    saveSettings.mutate({
      ...editableSettings,
      orderTtlMs: editableSettings.orderTtlMs as "60000" | "300000" | "900000" | "3600000",
    });
  };

  return (
    <>
      <GlassCard>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-[#FF6B35]" /> Risk Settings
          </CardTitle>
          <Button className="bg-[#FF6B35] text-black hover:bg-[#ff875d]" onClick={() => setConfirmSave(true)}>
            <Save className="mr-2 size-4" />
            Save Settings
          </Button>
        </CardHeader>
        <CardContent>
          {editableSettings ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SliderField label="Max Position USD" min={10} max={500} step={5} value={editableSettings.maxPositionUsd} onChange={v => updateSetting("maxPositionUsd", v)} suffix=" USD" />
              <SliderField label="Max Drawdown %" min={5} max={25} step={1} value={editableSettings.maxDrawdownPct} onChange={v => updateSetting("maxDrawdownPct", v)} suffix="%" />
              <SliderField label="Max Daily Loss %" min={1} max={10} step={0.5} value={editableSettings.maxDailyLossPct} onChange={v => updateSetting("maxDailyLossPct", v)} suffix="%" />
              <SliderField label="Max Spread %" min={1} max={20} step={0.5} value={editableSettings.maxSpread * 100} onChange={v => updateSetting("maxSpread", v / 100)} suffix="%" />
              <SliderField label="Max Single Market Exposure %" min={1} max={20} step={1} value={editableSettings.maxSingleMarketExposurePct} onChange={v => updateSetting("maxSingleMarketExposurePct", v)} suffix="%" />
              <SliderField label="Max Total Exposure %" min={5} max={50} step={1} value={editableSettings.maxTotalExposurePct} onChange={v => updateSetting("maxTotalExposurePct", v)} suffix="%" />
              <SliderField label="Min Edge %" min={3} max={15} step={0.5} value={editableSettings.minEdgePct} onChange={v => updateSetting("minEdgePct", v)} suffix="%" />
              <SliderField label="Min Confidence" min={0.5} max={0.95} step={0.01} value={editableSettings.minConfidence} onChange={v => updateSetting("minConfidence", v)} />
              <SliderField label="Fractional Kelly" min={0.1} max={0.5} step={0.01} value={editableSettings.fractionalKelly} onChange={v => updateSetting("fractionalKelly", v)} />
              {Object.entries(editableSettings.categoryCaps).map(([category, value]) => (
                <SliderField key={category} label={`${category} Exposure Cap`} min={1} max={50} step={1} value={Number(value)} onChange={next => updateSetting("categoryCaps", { ...editableSettings.categoryCaps, [category]: next })} suffix="%" />
              ))}
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <Label className="text-xs uppercase tracking-[0.16em] text-zinc-400">Order TTL</Label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[["1m", "60000"], ["5m", "300000"], ["15m", "900000"], ["1h", "3600000"]].map(([label, value]) => (
                    <Button key={value} size="sm" variant="outline" className={`border-white/10 ${editableSettings.orderTtlMs === value ? "bg-[#FF6B35] text-black border-transparent" : "bg-white/5"}`} onClick={() => updateSetting("orderTtlMs", value)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-zinc-500">Loading settings…</div>
          )}
        </CardContent>
      </GlassCard>

      {/* Wallet */}
      <GlassCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-[#FF6B35]" /> Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded border border-white/10 bg-black/30 p-3">
            <span className="font-mono text-sm">{compact(data?.wallet.address, 10, 8)}</span>
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5" onClick={() => data?.wallet.address && navigator.clipboard.writeText(data.wallet.address)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="USDC" value={usd(data?.wallet.usdcBalance)} />
            <Metric label="24h Change" value={`${usd(data?.wallet.usdc24hChangeUsd)} / ${pct(data?.wallet.usdc24hChangePct)}`} />
            <Metric label="MATIC" value={data?.wallet.maticBalance == null ? "RPC OFF" : Number(data.wallet.maticBalance).toFixed(4)} />
          </div>
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <div className="flex aspect-square items-center justify-center rounded border border-white/10 bg-white p-2">
              {data?.wallet.depositAddress ? (
                <img alt="Deposit QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(data.wallet.depositAddress)}`} className="size-full" />
              ) : (
                <XCircle className="text-zinc-900" />
              )}
            </div>
            <div className="text-xs text-zinc-400">
              <div className="mb-2 uppercase tracking-[0.14em]">Deposit Address</div>
              <div className="break-all font-mono text-zinc-200">{data?.wallet.depositAddress ?? "Unavailable"}</div>
            </div>
          </div>
        </CardContent>
      </GlassCard>

      <Dialog open={confirmSave} onOpenChange={setConfirmSave}>
        <DialogContent className="border-white/10 bg-[#111118] text-white">
          <DialogHeader>
            <DialogTitle>Confirm Settings Change?</DialogTitle>
            <DialogDescription>These changes affect live trading. They apply on the next bot tick.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-white/10 bg-white/5" onClick={() => setConfirmSave(false)}>Cancel</Button>
            <Button className="bg-[#FF6B35] text-black" onClick={applySettings}>
              {saveSettings.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Root Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const dashboard = trpc.operator.dashboard.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const data = dashboard.data;

  const handleRefresh = () => dashboard.refetch();

  const sidebarWidth = sidebarCollapsed ? "3.5rem" : "13rem";

  return (
    <div className="dark min-h-screen bg-[#07070D] font-[Inter,ui-sans-serif] text-white">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(rgba(255,107,53,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,53,0.13) 1px, transparent 1px)",
          backgroundSize: "40px 40px, 40px 40px, 200px 200px, 200px 200px",
        }}
      />

      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        data={data}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(prev => !prev)}
      />

      {/* Main content — offset by sidebar width */}
      <div className="relative z-10 min-h-screen transition-all duration-200" style={{ marginLeft: sidebarWidth }}>
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07070D]/85 px-4 py-3 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-sm font-semibold uppercase tracking-[0.2em]">
                {NAV_ITEMS.find(n => n.id === activeTab)?.label ?? "Overview"}
              </h1>
              <p className="text-[11px] text-zinc-500">POLY SHORE · Operator Console</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* LLM badge */}
              {data?.llm && (
                <div className="flex items-center gap-1.5">
                  <Badge className={data.llm.isFallback ? "border-amber-500/40 bg-amber-500/20 font-mono text-[11px] text-amber-300" : "border-sky-500/30 bg-sky-500/15 font-mono text-[11px] text-sky-300"}>
                    <BrainCircuit className="mr-1 size-3" />
                    {data.llm.isFallback ? "FALLBACK: " : "LLM: "}{data.llm.provider}
                  </Badge>
                  {data.llm.latencyMs > 0 && (
                    <Badge className="bg-white/5 font-mono text-[10px] text-zinc-400">{data.llm.latencyMs}ms</Badge>
                  )}
                </div>
              )}
              <BotControls data={data} onRefresh={handleRefresh} />
              <Button variant="outline" className="border-white/10 bg-white/5 h-9 w-9 p-0" onClick={handleRefresh}>
                <RefreshCcw className={`size-4 ${dashboard.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </header>

        {/* Tab content */}
        <main className="p-4 space-y-5">
          {activeTab === "overview" && <OverviewTab data={data} onRefresh={handleRefresh} />}
          {activeTab === "orders" && <OpenOrdersTab data={data} onRefresh={handleRefresh} />}
          {activeTab === "trades" && <TradesTab data={data} />}
          {activeTab === "scanner" && <ScannerTab onRefresh={handleRefresh} />}
          {activeTab === "arbitrage" && <ArbitrageTab data={data} onRefresh={handleRefresh} />}
          {activeTab === "settings" && <SettingsTab data={data} onRefresh={handleRefresh} />}
        </main>
      </div>

      {/* Error toast */}
      {dashboard.error && (
        <div className="fixed bottom-4 right-4 z-50 max-w-xl rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <AlertTriangle className="mr-2 inline size-4" />
          {dashboard.error.message}
        </div>
      )}
    </div>
  );
}
