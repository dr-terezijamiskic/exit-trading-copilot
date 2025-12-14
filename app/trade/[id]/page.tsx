'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Trade, PriceUpdate, Action } from '@/lib/types';
import type { RulesEngineOutput } from '@/lib/rulesEngine';

export default function TradePage() {
  const params = useParams();
  const router = useRouter();
  const tradeId = params.id as string;

  const [trade, setTrade] = useState<Trade | null>(null);
  const [priceUpdates, setPriceUpdates] = useState<PriceUpdate[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState('');
  const [chop, setChop] = useState(false);
  const [unsure, setUnsure] = useState(false);
  const [inProfit, setInProfit] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideInput, setShowOverrideInput] = useState(false);
  const [lastDecision, setLastDecision] = useState<RulesEngineOutput | null>(null);

  // Escalation v1 state
  const [exitNowStartTime, setExitNowStartTime] = useState<number | null>(null);
  const [violationLogged, setViolationLogged] = useState(false);
  const [showViolationBanner, setShowViolationBanner] = useState(false);

  const alarmIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const escalationTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadTrade();

    // Cleanup on unmount
    return () => {
      stopAlarm();
      if (escalationTimerRef.current) {
        clearTimeout(escalationTimerRef.current);
      }
    };
  }, [tradeId]);

  useEffect(() => {
    if (trade?.status === 'EXIT_NOW') {
      startAlarm();
    } else {
      stopAlarm();
    }
  }, [trade?.status]);

  // Escalation v1: Track EXIT_NOW duration and log violations
  useEffect(() => {
    if (trade?.status === 'EXIT_NOW') {
      // EXIT_NOW just started - record the start time
      if (exitNowStartTime === null) {
        const now = Date.now();
        setExitNowStartTime(now);
        setViolationLogged(false);
        setShowViolationBanner(false);

        // Start 60-second escalation timer
        escalationTimerRef.current = setTimeout(async () => {
          // Still in EXIT_NOW after 60s - log violation and show banner
          if (!violationLogged && trade) {
            setShowViolationBanner(true);
            setViolationLogged(true);

            // Log RULE_VIOLATION action
            try {
              await fetch('/api/actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tradeId: trade.id,
                  type: 'RULE_VIOLATION',
                  payload: { seconds: 60, tradeId: trade.id },
                }),
              });
              // Refresh timeline to show the violation
              await loadTimeline();
            } catch (error) {
              console.error('Error logging rule violation:', error);
            }
          }
        }, 60000); // 60 seconds
      }
    } else {
      // Status is no longer EXIT_NOW - reset escalation state
      if (exitNowStartTime !== null) {
        setExitNowStartTime(null);
        setViolationLogged(false);
        setShowViolationBanner(false);
        if (escalationTimerRef.current) {
          clearTimeout(escalationTimerRef.current);
          escalationTimerRef.current = null;
        }
      }
    }
  }, [trade?.status, exitNowStartTime, violationLogged]);

  const loadTrade = async () => {
    try {
      const response = await fetch(`/api/trades/${tradeId}`);
      if (!response.ok) {
        // Trade not found - redirect to review page
        router.push('/review');
        return;
      }
      const data = await response.json();
      setTrade(data);
      await loadTimeline();
    } catch (error) {
      console.error('Error loading trade:', error);
      router.push('/review');
    } finally {
      setLoading(false);
    }
  };

  const loadTimeline = async () => {
    try {
      const [priceUpdatesRes, actionsRes] = await Promise.all([
        fetch(`/api/trades/${tradeId}/price-updates?limit=30`),
        fetch(`/api/trades/${tradeId}/actions`),
      ]);

      if (priceUpdatesRes.ok) {
        const priceUpdatesData = await priceUpdatesRes.json();
        setPriceUpdates(priceUpdatesData);
      }

      if (actionsRes.ok) {
        const actionsData = await actionsRes.json();
        setActions(actionsData);
      }
    } catch (error) {
      console.error('Error loading timeline:', error);
    }
  };

  const startAlarm = () => {
    if (alarmIntervalRef.current) return; // Already running

    // Create alarm sound using Web Audio API
    const playAlarmSound = () => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 880; // A5 note
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    };

    // Play immediately
    playAlarmSound();

    // Repeat every 2 seconds
    alarmIntervalRef.current = setInterval(() => {
      playAlarmSound();
    }, 2000);
  };

  const stopAlarm = () => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  };

  const handlePriceUpdate = async () => {
    if (!currentPrice || !trade) return;

    const price = parseFloat(currentPrice);

    try {
      // ============================================
      // CALL RULES ENGINE VIA API
      // UI does NOT decide status - rules engine does
      // ============================================
      const response = await fetch('/api/price-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: trade.id,
          price,
          chop,
          unsure,
          inProfit,
        }),
      });

      if (!response.ok) throw new Error('Failed to update price');

      const result = await response.json();
      const { decision } = result;

      // Store the decision from rules engine
      setLastDecision(decision);

      // Server handles PATCH to EXIT_NOW - client just reloads

      // Reset form
      setCurrentPrice('');
      setChop(false);
      setUnsure(false);
      setInProfit(false);

      // Reload trade
      await loadTrade();
    } catch (error) {
      console.error('Error updating price:', error);
      alert('Failed to update price');
    }
  };

  const handleExit = async () => {
    if (!trade) return;

    try {
      // Create EXIT action
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: trade.id,
          type: 'EXIT',
          payload: {},
        }),
      });

      // Update trade to CLOSED
      await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'CLOSED',
        }),
      });

      // Stop alarm and redirect
      stopAlarm();
      router.push('/review');
    } catch (error) {
      console.error('Error exiting trade:', error);
      alert('Failed to exit trade');
    }
  };

  const handleOverride = async () => {
    if (!trade || !overrideReason.trim()) {
      alert('Please provide a reason for override');
      return;
    }

    try {
      // Create OVERRIDE action
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: trade.id,
          type: 'OVERRIDE',
          payload: { reason: overrideReason },
        }),
      });

      // Update trade back to ACTIVE
      await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ACTIVE',
        }),
      });

      // Reset and reload
      setOverrideReason('');
      setShowOverrideInput(false);
      stopAlarm();
      await loadTrade();
    } catch (error) {
      console.error('Error overriding:', error);
      alert('Failed to override');
    }
  };

  const handleReduce = async () => {
    if (!trade) return;

    try {
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: trade.id,
          type: 'REDUCE',
          payload: { amount: '50%' },
        }),
      });

      alert('Reduced position by 50%');
      await loadTimeline();
    } catch (error) {
      console.error('Error reducing:', error);
      alert('Failed to log reduce action');
    }
  };

  if (loading) {
    return <div className="text-3xl text-center mt-20">Loading...</div>;
  }

  if (!trade) {
    return <div className="text-3xl text-center mt-20">Trade not found</div>;
  }

  const isExitNow = trade.status === 'EXIT_NOW';
  const isClosed = trade.status === 'CLOSED';
  // Reduce suggestions come ONLY from rules engine decision
  const showReduceSuggestion = lastDecision?.status === 'SUGGEST_REDUCE' && !isExitNow && !isClosed;

  // Semantic color constants - STRICT LIMITS
  const DANGER_CLASSES = 'bg-red-600 border-red-600 text-white';
  const WARNING_CLASSES = 'bg-yellow-500 border-yellow-500 text-black';

  return (
    <div className="max-w-4xl mx-auto">
      {isExitNow && (
        <div className={`mb-6 p-6 ${DANGER_CLASSES} border-4 rounded-lg animate-pulse`}>
          <h2 className="text-4xl font-bold mb-2">
            EXIT NOW - INVALIDATION TRIGGERED
          </h2>
          <p className="text-xl">
            Price has reached invalidation level. Exit immediately.
          </p>
        </div>
      )}

      {showViolationBanner && (
        <div className="mb-6 p-6 bg-card border-4 border-border rounded-lg">
          <h2 className="text-4xl font-bold mb-2">
            ⚠ RULE VIOLATION
          </h2>
          <p className="text-xl font-medium">
            EXIT_NOW active for 60+ seconds
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-5xl font-bold mb-2">{trade.ticker}</h1>
            <p className="text-2xl text-muted">{trade.timeframe} · {trade.direction}</p>
          </div>
          <div className="px-6 py-3 rounded-lg text-2xl font-bold bg-card border border-border">
            {trade.status}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-xl text-muted mb-1">Setup</p>
            <p className="text-2xl">{trade.setup}</p>
          </div>
          <div>
            <p className="text-xl text-muted mb-1">Invalidation Price</p>
            <p className="text-2xl font-mono">${trade.invalidationPrice}</p>
          </div>
        </div>

        {trade.notes && (
          <div>
            <p className="text-xl text-muted mb-1">Notes</p>
            <p className="text-2xl">{trade.notes}</p>
          </div>
        )}
      </div>

      {!isClosed && (
        <>
          {!isExitNow && (
            <div className="bg-card border border-border rounded-lg p-6 mb-6">
              <h2 className="text-3xl font-bold mb-4">Price Update</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xl font-medium mb-2">Current Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={currentPrice}
                    onChange={(e) => setCurrentPrice(e.target.value)}
                    className="w-full px-4 py-3 text-2xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                    placeholder="0.00"
                  />
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chop}
                      onChange={(e) => setChop(e.target.checked)}
                      className="w-6 h-6"
                    />
                    <span className="text-xl">Chop</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={unsure}
                      onChange={(e) => setUnsure(e.target.checked)}
                      className="w-6 h-6"
                    />
                    <span className="text-xl">Unsure</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inProfit}
                      onChange={(e) => setInProfit(e.target.checked)}
                      className="w-6 h-6"
                    />
                    <span className="text-xl">In Profit</span>
                  </label>
                </div>

                {showReduceSuggestion && lastDecision && (
                  <div className={`p-4 ${WARNING_CLASSES} border rounded-lg`}>
                    <p className="text-xl mb-3">
                      {lastDecision.reason}
                    </p>
                    <button
                      onClick={handleReduce}
                      className="px-6 py-2 bg-card hover:bg-background border border-border rounded-lg text-lg font-medium transition-colors"
                    >
                      REDUCE 50%
                    </button>
                  </div>
                )}

                <button
                  onClick={handlePriceUpdate}
                  disabled={!currentPrice}
                  className="w-full py-4 text-2xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update Price
                </button>

                <button
                  onClick={handleExit}
                  className="w-full py-3 text-xl font-medium bg-card hover:bg-background border border-border rounded-lg transition-colors"
                >
                  EXIT TRADE
                </button>
              </div>
            </div>
          )}

          {isExitNow && (
            <div className="bg-card border-4 border-border rounded-lg p-6 space-y-4">
              <h2 className="text-3xl font-bold mb-4">Action Required</h2>

              {!showOverrideInput ? (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={handleExit}
                    className={`py-6 text-3xl font-bold ${DANGER_CLASSES} rounded-lg transition-colors`}
                  >
                    EXIT
                  </button>
                  <button
                    onClick={() => setShowOverrideInput(true)}
                    className="py-6 text-3xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors"
                  >
                    OVERRIDE
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xl font-medium mb-2">
                      Override Reason (Required)
                    </label>
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-border"
                      placeholder="Why are you overriding invalidation?"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={handleOverride}
                      disabled={!overrideReason.trim()}
                      className="py-4 text-2xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Confirm Override
                    </button>
                    <button
                      onClick={() => {
                        setShowOverrideInput(false);
                        setOverrideReason('');
                      }}
                      className="py-4 text-2xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {isClosed && (
        <div className="bg-card border border-border rounded-lg p-6 text-center">
          <p className="text-3xl text-muted mb-4">Trade Closed</p>
          <button
            onClick={() => router.push('/review')}
            className="px-8 py-4 text-2xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors"
          >
            View All Trades
          </button>
        </div>
      )}

      {/* Timeline - Price Updates */}
      <div className="mt-8 bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 bg-background border-b border-border">
          <h2 className="text-3xl font-bold">Price Updates (Last 30)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-background border-b border-border">
              <tr>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Time</th>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Price</th>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Flags</th>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Status After</th>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Reason</th>
              </tr>
            </thead>
            <tbody>
              {priceUpdates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center px-6 py-8 text-xl text-muted">
                    No price updates yet
                  </td>
                </tr>
              ) : (
                priceUpdates.map((update) => (
                  <tr key={update.id} className="border-b border-border hover:bg-card-hover transition-colors">
                    <td className="px-6 py-3 text-lg font-mono text-muted">
                      {new Date(update.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="px-6 py-3 text-xl font-mono font-bold">
                      ${update.price.toFixed(2)}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-2">
                        {update.chop && <span className="px-2 py-1 bg-card border border-border text-sm rounded">Chop</span>}
                        {update.unsure && <span className="px-2 py-1 bg-card border border-border text-sm rounded">Unsure</span>}
                        {update.inProfit && <span className="px-2 py-1 bg-card border border-border text-sm rounded">Profit</span>}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className="px-3 py-1 rounded text-lg font-medium bg-card border border-border">
                        {update.statusAfter}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-lg text-muted max-w-md truncate">
                      {update.reason || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Timeline - Actions */}
      <div className="mt-6 bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 bg-background border-b border-border">
          <h2 className="text-3xl font-bold">Actions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-background border-b border-border">
              <tr>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Time</th>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Type</th>
                <th className="text-left px-6 py-3 text-xl font-medium text-muted">Details</th>
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center px-6 py-8 text-xl text-muted">
                    No actions yet
                  </td>
                </tr>
              ) : (
                actions.map((action) => {
                  const payload = JSON.parse(action.payload);
                  return (
                    <tr key={action.id} className="border-b border-border hover:bg-card-hover transition-colors">
                      <td className="px-6 py-3 text-lg font-mono text-muted">
                        {new Date(action.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-6 py-3">
                        <span className="px-3 py-1 rounded text-lg font-medium bg-card border border-border">
                          {action.type}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-lg">
                        {action.type === 'OVERRIDE' && payload.reason ? (
                          <span>Reason: {payload.reason}</span>
                        ) : action.type === 'REDUCE' && payload.amount ? (
                          <span>Amount: {payload.amount}</span>
                        ) : action.type === 'RULE_VIOLATION' && payload.seconds ? (
                          <span className="font-medium">EXIT_NOW ignored for {payload.seconds}s</span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
