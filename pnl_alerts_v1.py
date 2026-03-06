import argparse
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Tuple

from ib_insync import IB


# -----------------------------
# Utilities
# -----------------------------
def ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def load_json(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path: str, data: Any) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    os.replace(tmp, path)


# -----------------------------
# Safety: "no trades" guardrail
# -----------------------------
def assert_no_trade_code():
    """
    This script is intentionally REPORT/ALERT ONLY.
    If you/Claude ever adds order placement here, raise immediately.
    (We don't even import order classes in v1.)
    """
    # Placeholder: if anyone adds "placeOrder" usage, keep this concept and hard-fail.
    return


# -----------------------------
# Data fetch
# -----------------------------
def connect_ib(host: str, port: int, client_id: int) -> IB:
    ib = IB()
    # Some ib_insync versions support readonly=True; some don't.
    try:
        ib.connect(host, port, clientId=client_id, readonly=True)
    except TypeError:
        ib.connect(host, port, clientId=client_id)
    return ib


def fetch_positions(ib: IB, stocks_only: bool) -> List[Dict[str, Any]]:
    """
    Returns a normalized list of positions from ib.portfolio().
    Each entry includes: symbol, secType, position, avgCost, contract
    """
    positions = []
    for item in ib.portfolio():
        c = item.contract
        symbol = getattr(c, "symbol", None)
        sec_type = getattr(c, "secType", None)

        if not symbol or not sec_type:
            continue
        if stocks_only and sec_type != "STK":
            continue

        pos = float(item.position or 0.0)
        if pos == 0:
            continue

        avg = float(item.averageCost or 0.0)
        if avg <= 0:
            continue

        positions.append({
            "symbol": symbol,
            "secType": sec_type,
            "position": pos,
            "avgCost": avg,
            "contract": c,
        })
    return positions


def fetch_price_snapshot(ib: IB, contract) -> Optional[float]:
    """
    Gets a 'best available' price without subscribing forever.
    Prefers last, then mid (bid/ask), then close.
    """
    t = ib.reqMktData(contract, snapshot=True)
    ib.sleep(1.0)

    last = t.last
    bid = t.bid
    ask = t.ask
    close = t.close

    if last and last > 0:
        return float(last)
    if bid and ask and bid > 0 and ask > 0:
        return float((bid + ask) / 2.0)
    if close and close > 0:
        return float(close)
    return None


# -----------------------------
# Logic
# -----------------------------
def pnl_pct_long(avg_cost: float, price: float) -> float:
    return (price - avg_cost) / avg_cost


def should_fire(pnl_pct: float, tp: float, sl: float) -> Tuple[bool, bool]:
    return (pnl_pct >= tp, pnl_pct <= sl)


# -----------------------------
# Alerts + State
# -----------------------------
def send_alert(message: str) -> None:
    # v1: print only. v2: Telegram/email/SMS.
    print(message, flush=True)


def is_fired(state: Dict[str, Any], symbol: str, kind: str) -> bool:
    return bool(state.get(symbol, {}).get(kind))


def mark_fired(state: Dict[str, Any], symbol: str, kind: str, payload: Dict[str, Any]) -> None:
    state.setdefault(symbol, {})
    state[symbol][kind] = payload


# -----------------------------
# Main loop
# -----------------------------
def run_loop(
    host: str,
    port: int,
    client_id: int,
    tp: float,
    sl: float,
    interval: int,
    state_file: str,
    stocks_only: bool,
    once: bool,
) -> None:
    assert_no_trade_code()

    state = load_json(state_file, default={})

    ib = connect_ib(host, port, client_id)
    send_alert(f"[{ts()}] Connected to TWS. Monitoring TP={tp*100:.1f}% / SL={sl*100:.1f}%. Port={port}")

    try:
        while True:
            positions = fetch_positions(ib, stocks_only=stocks_only)

            if not positions:
                send_alert(f"[{ts()}] No positions found (paper account may be empty).")
            else:
                for p in positions:
                    symbol = p["symbol"]
                    sec_type = p["secType"]
                    pos = p["position"]
                    avg = p["avgCost"]
                    contract = p["contract"]

                    # v1: long positions only (easy + stable)
                    if pos < 0:
                        continue

                    price = fetch_price_snapshot(ib, contract)
                    if not price:
                        continue

                    pnl = pnl_pct_long(avg, price)
                    fire_tp, fire_sl = should_fire(pnl, tp=tp, sl=sl)

                    if fire_tp and not is_fired(state, symbol, "TP"):
                        msg = f"[{ts()}] ✅ TP {symbol} ({sec_type}) PnL={pnl*100:.2f}% avg={avg:.4f} price={price:.4f}"
                        send_alert(msg)
                        mark_fired(state, symbol, "TP", {"ts": ts(), "pnl_pct": pnl, "avg": avg, "price": price})

                    if fire_sl and not is_fired(state, symbol, "SL"):
                        msg = f"[{ts()}] 🛑 SL {symbol} ({sec_type}) PnL={pnl*100:.2f}% avg={avg:.4f} price={price:.4f}"
                        send_alert(msg)
                        mark_fired(state, symbol, "SL", {"ts": ts(), "pnl_pct": pnl, "avg": avg, "price": price})

                save_json(state_file, state)

            if once:
                break
            time.sleep(interval)

    finally:
        ib.disconnect()
        send_alert(f"[{ts()}] Disconnected.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=7497, help="TWS paper default 7497; live default 7496.")
    ap.add_argument("--client-id", type=int, default=7)
    ap.add_argument("--tp", type=float, default=0.25, help="0.25 = +25%")
    ap.add_argument("--sl", type=float, default=-0.10, help="-0.10 = -10%")
    ap.add_argument("--interval", type=int, default=180, help="seconds between checks")
    ap.add_argument("--state-file", default="alert_state.json")
    ap.add_argument("--stocks-only", action="store_true")
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()

    run_loop(
        host=args.host,
        port=args.port,
        client_id=args.client_id,
        tp=args.tp,
        sl=args.sl,
        interval=args.interval,
        state_file=args.state_file,
        stocks_only=args.stocks_only,
        once=args.once,
    )


if __name__ == "__main__":
    main()


