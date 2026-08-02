const items = [
  ["ALERT", "高优先级"],
  ["WATCH", "继续观察"],
  ["SKIP", "硬性过滤"],
  ["ERROR", "数据源错误"]
];

export default function Summary({ page, candidates, errorCount }) {
  const counts = candidates.reduce((result, item) => {
    result[item.priority] = (result[item.priority] || 0) + 1;
    return result;
  }, {});
  counts.ERROR = errorCount;
  return (
    <section className="summary-strip" aria-label="扫描摘要">
      {items.map(([key, label]) => (
        <div className={`summary-item tone-${key.toLowerCase()}`} key={key}>
          <span>{label}</span>
          <strong>{counts[key] || 0}</strong>
        </div>
      ))}
      <p className="summary-note">
        {page.key === "discovery"
          ? "猎星榜优先覆盖，不代表已通过安全确认"
          : "验金榜严格过滤，可能牺牲部分早期覆盖"}
      </p>
    </section>
  );
}
