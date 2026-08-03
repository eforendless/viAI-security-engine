import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Panel } from "../ui";

interface DashboardChartsProps {
  activity: Array<{ day: string; value: number }>;
  distribution: Array<{ name: string; value: number; color: string }>;
}

export default function DashboardCharts({ activity, distribution }: DashboardChartsProps) {
  const activityTotal = activity.reduce((sum, point) => sum + point.value, 0);
  const distributionTotal = distribution.reduce((sum, item) => sum + item.value, 0);

  return <section className="overview-chart-grid">
    <Panel className="overview-chart"><div className="panel-heading"><div><p className="eyebrow">ANALYSIS ACTIVITY</p><h3>Daily files scanned</h3><p>Last 30 days, based on local analysis records.</p></div><strong className="overview-total">{formatCount(activityTotal)}</strong></div><div className="overview-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={activity}><defs><linearGradient id="overviewActivity" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#397ec1" stopOpacity={0.35} /><stop offset="100%" stopColor="#397ec1" stopOpacity={0} /></linearGradient></defs><Tooltip formatter={(value) => [formatCount(Number(value)), "Files scanned"]} /><Area type="monotone" dataKey="value" stroke="#2f80b8" strokeWidth={2.5} fill="url(#overviewActivity)" isAnimationActive={false} /></AreaChart></ResponsiveContainer></div></Panel>
    <Panel className="overview-risk"><div className="panel-heading"><div><p className="eyebrow">RISK DISTRIBUTION</p><h3>Complete local database</h3></div></div><div className="overview-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={distribution} dataKey="value" innerRadius={47} outerRadius={68} paddingAngle={3} stroke="none" isAnimationActive={false}>{distribution.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer><div><strong>{formatCount(distributionTotal)}</strong><span>results</span></div></div><div className="overview-risk-list">{distribution.map((item) => <span key={item.name}><i style={{ background: item.color }} /><b>{item.name}</b><em>{formatCount(item.value)}</em><small>{distributionTotal ? `${Math.round(item.value / distributionTotal * 100)}%` : "0%"}</small></span>)}</div></Panel>
  </section>;
}

function formatCount(value: number): string { return new Intl.NumberFormat().format(value); }