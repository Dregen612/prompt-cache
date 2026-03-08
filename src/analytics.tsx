// Usage Analytics Dashboard for PromptCache
export function AnalyticsDashboard() {
  const [period, setPeriod] = useState('24h');
  const [data, setData] = useState<any>(null);
  
  useEffect(() => {
    fetch(`/api/analytics?period=${period}`)
      .then(r => r.json())
      .then(setData);
  }, [period]);
  
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">📊 Analytics</h2>
        <select value={period} onChange={e => setPeriod(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
          <option value="1h">Last Hour</option>
          <option value="24h">Last 24 Hours</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Total Requests</div>
          <div className="text-2xl font-bold">{data?.totalRequests?.toLocaleString() || '-'}</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Cache Hits</div>
          <div className="text-2xl font-bold text-green-400">{data?.cacheHits?.toLocaleString() || '-'}</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Hit Rate</div>
          <div className="text-2xl font-bold text-blue-400">{data?.hitRate || 0}%</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-sm">Avg Latency</div>
          <div className="text-2xl font-bold">{data?.avgLatency || 0}ms</div>
        </div>
      </div>
      
      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        {/* Requests Over Time */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="font-semibold mb-4">Requests Over Time</h3>
          <div className="h-48 flex items-end gap-2">
            {(data?.hourlyRequests || []).map((r: any, i: number) => (
              <div key={i} className="flex-1 bg-indigo-500 rounded-t" style={{ height: `${Math.min(100, (r.requests / 100) * 100)}%` }}></div>
            ))}
          </div>
        </div>
        
        {/* Top Models */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="font-semibold mb-4">Top Models</h3>
          <div className="space-y-3">
            {(data?.topModels || []).map((m: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-gray-400 w-6">{i + 1}.</span>
                <span className="flex-1">{m.model}</span>
                <span className="text-indigo-400">{m.requests?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Cache Savings */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="font-semibold mb-4">Cost Savings</h3>
          <div className="text-4xl font-bold text-green-400">${data?.costSaved || 0}</div>
          <p className="text-gray-400 text-sm mt-2">Estimated savings from caching</p>
        </div>
        
        {/* Tokens Saved */}
        <div className="bg-gray-800 rounded-xl p-4">
          <h3 className="font-semibold mb-4">Tokens Saved</h3>
          <div className="text-4xl font-bold text-blue-400">{data?.tokensSaved?.toLocaleString() || 0}</div>
          <p className="text-gray-400 text-sm mt-2">Total tokens cached</p>
        </div>
      </div>
    </div>
  );
}
