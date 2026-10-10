import { BarChart3, Boxes, Images, Search, Tags, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Statistics as StatisticsData } from '../../types';
import { categoryColor, label, number } from '../../lib/format';

export function StatisticCards({
  data,
  results,
  loading,
}: Readonly<{
  data?: StatisticsData;
  results?: number;
  loading: boolean;
}>) {
  const cards = [
    {
      title: 'Total Images',
      value: data?.total_images,
      description: 'In your visual collection',
      Icon: Images,
      className: 'indigo',
    },
    {
      title: 'Detected Objects',
      value: data?.total_objects,
      description: 'Indexed object instances',
      Icon: Boxes,
      className: 'teal',
    },
    {
      title: 'Object Categories',
      value: data?.total_categories,
      description: 'Unique searchable categories',
      Icon: Tags,
      className: 'amber',
    },
    {
      title: 'Search Results',
      value: results,
      description: 'Images in the current view',
      Icon: Search,
      className: 'violet',
    },
  ];
  return (
    <div className="statistic-grid">
      {cards.map(({ title, value, description, Icon, className }) => (
        <div className="statistic-card" key={title}>
          <div>
            <span className="statistic-label">{title}</span>
            <strong className={loading ? 'statistic-loading' : ''}>
              {value === undefined ? '—' : number(value)}
            </strong>
            <p>{description}</p>
          </div>
          <span className={`statistic-icon ${className}`}>
            <Icon size={21} strokeWidth={1.7} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function DistributionChart({ data }: Readonly<{ data: StatisticsData }>) {
  const chartData = data.distribution.slice(0, 10).map((item) => ({
    ...item,
    display_name: label(item.class_name),
    fill: categoryColor(item.class_name),
  }));
  return (
    <section className="panel distribution-panel">
      <div className="section-heading">
        <div>
          <h2>
            <BarChart3 size={19} />
            Object Distribution
          </h2>
          <p>The most frequent objects in your indexed collection.</p>
        </div>
        <span className="subtle-badge">At the current confidence threshold</span>
      </div>
      {chartData.length ? (
        <div
          className="chart-area"
          role="img"
          aria-label={chartData.map((item) => `${item.display_name}: ${item.count}`).join(', ')}
        >
          <ResponsiveContainer width="100%" height={280} minWidth={1}>
            <BarChart data={chartData} margin={{ left: -20, right: 12, top: 15, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="#eef0f5" />
              <XAxis
                dataKey="display_name"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: '#7b8192' }}
                interval={0}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: '#7b8192' }}
              />
              <Tooltip
                cursor={{ fill: '#f5f6fc' }}
                contentStyle={{ border: '1px solid #e8eaf3', borderRadius: 10, fontSize: 12 }}
                formatter={(value) => [value, 'Objects']}
              />
              <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={46} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-empty">
          <TrendingUp size={30} strokeWidth={1.5} />
          <h3>Your collection, at a glance</h3>
          <p>Upload images to see the objects that make up your collection.</p>
        </div>
      )}
      <div className="chart-footer">
        <span>
          <i /> Actual indexed detections
        </span>
        <span>
          {number(data.total_objects)} objects across {number(data.total_categories)} categories
        </span>
      </div>
    </section>
  );
}
