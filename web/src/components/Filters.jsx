import { SearchIcon } from "./Icons.jsx";

const priorityOptions = [
  ["saved", "收藏"],
  ["focus", "重点"],
  ["all", "全部"],
  ["ALERT", "ALERT"],
  ["WATCH", "WATCH"],
  ["SKIP", "SKIP"]
];

export default function Filters({ filters, onChange, resultCount }) {
  function update(name, value) {
    onChange({ ...filters, [name]: value });
  }
  return (
    <section className="filterbar" aria-label="候选筛选">
      <div className="segmented" aria-label="优先级">
        {priorityOptions.map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={filters.priority === value ? "active" : ""}
            onClick={() => update("priority", value)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="select-control">
        <span>链</span>
        <select value={filters.chain} onChange={(event) => update("chain", event.target.value)}>
          <option value="all">全部</option>
          <option value="sol">Solana</option>
          <option value="bsc">BSC</option>
        </select>
      </label>
      <label className="select-control">
        <span>阶段</span>
        <select value={filters.phase} onChange={(event) => update("phase", event.target.value)}>
          <option value="all">全部</option>
          <option value="EARLY">早期</option>
          <option value="BREAKOUT">突破</option>
          <option value="LATE">后段</option>
          <option value="WATCHING">观察</option>
        </select>
      </label>
      <label className="select-control select-control-created">
        <span>创建</span>
        <select value={filters.createdWithin} onChange={(event) => update("createdWithin", event.target.value)}>
          <option value="all">全部时间</option>
          <option value="3600">1小时内</option>
          <option value="14400">4小时内</option>
          <option value="43200">12小时内</option>
          <option value="86400">24小时内</option>
          <option value="604800">7天内</option>
        </select>
      </label>
      <label className="search-control">
        <SearchIcon />
        <input
          value={filters.query}
          onChange={(event) => update("query", event.target.value)}
          placeholder="搜索代币或合约"
          aria-label="搜索代币或合约"
        />
      </label>
      <span className="result-count">{resultCount} 个结果</span>
    </section>
  );
}
