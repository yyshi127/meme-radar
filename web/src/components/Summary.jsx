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
          ? "ALERT 已完成安全验证且安全分 ≥70；WATCH 可能仍待核验"
          : "验金榜严格过滤，可能牺牲部分早期覆盖"}
      </p>
    </section>
  );
}
