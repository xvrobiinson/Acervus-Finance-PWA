// A line chart of real end-of-day values (portfolio value against capital
// invested), drawn as straight segments between computed points.

import type { HistoryPoint } from "../../shared/domain/portfolio";
import type { Fmt } from "../lib/format";

export function GrowthChart({ points, fmt, label }: { points: HistoryPoint[]; fmt: Fmt; label: string }) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  const values = points.flatMap((p) => [p.portfolioValue, p.netInvested]);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    hi += 100;
    lo -= 100;
  }
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = (k: "portfolioValue" | "netInvested") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const line = path("portfolioValue");
  const area = `${line}L${x(points.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`;
  const last = points[points.length - 1];
  return (
    <figure className="chart" style={{ margin: 0 }} aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        {[0, 0.5, 1].map((f) => (
          <line key={f} className="gridline" x1={pad.l} x2={W - pad.r} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} />
        ))}
        <path className="area" d={area} />
        <path className="line2" d={path("netInvested")} vectorEffect="non-scaling-stroke" />
        <path className="line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="row between micro muted" style={{ marginTop: 4 }}>
        <span>{fmt.dayShort(points[0].date)}</span>
        <span>
          {fmt.compact(lo)} – {fmt.compact(hi)}
        </span>
        <span>{fmt.dayShort(last.date)}</span>
      </figcaption>
    </figure>
  );
}
