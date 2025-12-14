'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { TradeDirection, Trade } from '@/lib/types';

export default function NewTradePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [hasActiveTrades, setHasActiveTrades] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [acknowledgedMultiTrade, setAcknowledgedMultiTrade] = useState(false);
  const [formData, setFormData] = useState({
    ticker: '',
    direction: 'LONG' as TradeDirection,
    setup: '',
    extraContext: '',
    timeframe: '',
    invalidationPrice: '',
    is0DTE: false,
    notes: '',
  });

  useEffect(() => {
    checkForActiveTrades();
  }, []);

  const checkForActiveTrades = async () => {
    try {
      const response = await fetch('/api/trades');
      if (response.ok) {
        const trades: Trade[] = await response.json();
        const activeExists = trades.some(t => t.status === 'ACTIVE');
        setHasActiveTrades(activeExists);
        if (activeExists) {
          setShowWarning(true);
        }
      }
    } catch (error) {
      console.error('Error checking active trades:', error);
    }
  };

  const handleContinueAnyway = () => {
    setShowWarning(false);
    setAcknowledgedMultiTrade(true);
  };

  const handleCancel = () => {
    router.back();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Combine setup and extraContext for submission
      const submitData = {
        ...formData,
        setup: formData.extraContext
          ? `${formData.setup} - ${formData.extraContext}`
          : formData.setup,
      };

      const response = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      });

      if (!response.ok) throw new Error('Failed to create trade');

      const trade = await response.json();

      // If user acknowledged multi-trade warning, log it
      if (acknowledgedMultiTrade) {
        await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradeId: trade.id,
            type: 'MULTI_TRADE_ACK',
            payload: { acknowledged: true },
          }),
        });
      }

      router.push(`/trade/${trade.id}`);
    } catch (error) {
      console.error('Error creating trade:', error);
      alert('Failed to create trade. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Multi-trade warning modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-8 max-w-lg mx-4">
            <h2 className="text-3xl font-bold mb-4">Active Trade Detected</h2>
            <p className="text-xl mb-6">
              You already have an active trade. Are you intentionally managing more than one position?
            </p>
            <div className="flex gap-4">
              <button
                onClick={handleContinueAnyway}
                className="flex-1 py-4 text-xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors"
              >
                Continue Anyway
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 py-4 text-xl font-bold bg-card hover:bg-background border border-border rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <h1 className="text-5xl font-bold mb-8">Pre-Trade Contract</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-card border border-border rounded-lg p-6 space-y-6">
          <div>
            <label htmlFor="ticker" className="block text-2xl font-medium mb-2">
              Ticker
            </label>
            <input
              id="ticker"
              type="text"
              required
              value={formData.ticker}
              onChange={(e) => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })}
              className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="SPY"
            />
          </div>

          <div>
            <label className="block text-2xl font-medium mb-2">
              Direction
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, direction: 'LONG' })}
                className={`flex-1 py-3 text-xl font-medium rounded-lg border-2 transition-colors ${
                  formData.direction === 'LONG'
                    ? 'bg-success border-success text-white'
                    : 'bg-background border-border text-foreground hover:border-success'
                }`}
              >
                LONG (CALL)
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, direction: 'SHORT' })}
                className={`flex-1 py-3 text-xl font-medium rounded-lg border-2 transition-colors ${
                  formData.direction === 'SHORT'
                    ? 'bg-danger border-danger text-white'
                    : 'bg-background border-border text-foreground hover:border-danger'
                }`}
              >
                SHORT (PUT)
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="setup" className="block text-2xl font-medium mb-2">
              Setup (Primary Reason)
            </label>
            <select
              id="setup"
              required
              value={formData.setup}
              onChange={(e) => setFormData({ ...formData, setup: e.target.value })}
              className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a setup...</option>
              <option value="EMA Pullback">EMA Pullback</option>
              <option value="VWAP Reclaim">VWAP Reclaim</option>
              <option value="Momentum Extension">Momentum Extension</option>
              <option value="Breakout / ORB">Breakout / ORB</option>
              <option value="Lotto / Speculative">Lotto / Speculative</option>
            </select>
          </div>

          <div>
            <label htmlFor="extraContext" className="block text-2xl font-medium mb-2">
              Extra context (optional)
            </label>
            <input
              id="extraContext"
              type="text"
              value={formData.extraContext}
              onChange={(e) => setFormData({ ...formData, extraContext: e.target.value })}
              className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Additional details about this setup..."
            />
          </div>

          <div>
            <label htmlFor="timeframe" className="block text-2xl font-medium mb-2">
              Timeframe
            </label>
            <select
              id="timeframe"
              required
              value={formData.timeframe}
              onChange={(e) => setFormData({ ...formData, timeframe: e.target.value })}
              className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select timeframe...</option>
              <option value="3m">3m</option>
              <option value="5m">5m</option>
            </select>
            <p className="text-muted mt-2 text-lg">
              This is the chart you are managing the trade on.
            </p>
          </div>

          <div>
            <label htmlFor="invalidationPrice" className="block text-2xl font-medium mb-2">
              Invalidation Price (Idea is wrong below this)
            </label>
            <input
              id="invalidationPrice"
              type="number"
              step="0.01"
              required
              value={formData.invalidationPrice}
              onChange={(e) => setFormData({ ...formData, invalidationPrice: e.target.value })}
              className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="0.00"
            />
            <p className="text-muted mt-2 text-lg">
              EXIT_NOW triggers if price touches this level.
            </p>
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is0DTE}
                onChange={(e) => setFormData({ ...formData, is0DTE: e.target.checked })}
                className="w-6 h-6"
              />
              <div>
                <span className="text-2xl font-medium">0DTE (Same-Day Expiry)</span>
                <p className="text-muted text-lg">Faster exit threshold (3 updates vs 4)</p>
              </div>
            </label>
          </div>

          <div>
            <label htmlFor="notes" className="block text-2xl font-medium mb-2">
              Notes (Optional)
            </label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-4 py-3 text-xl bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Additional observations..."
              rows={2}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-6 text-3xl font-bold bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'CREATING...' : "I'M IN"}
        </button>
      </form>
    </div>
  );
}
