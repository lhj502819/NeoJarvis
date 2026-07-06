function App() {
  const { data: tasksData, error: tasksError } = usePolling('/tasks', 2000);
  const { data: stateData } = usePolling('/api/state', 3000);
  const { data: agentsData } = usePolling('/api/agents', 2000);
  const { data: historyData } = usePolling('/api/history', 5000);
  const { data: recipesData } = usePolling('/api/recipes', 10000);
  const { events, connected } = useSSE('/events');

  const tasks = tasksData?.tasks || [];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">J</div>
          <span className="header-title">Jarvis Dashboard</span>
        </div>
        <div className="header-status">
          <div className={`status-dot ${connected ? '' : 'offline'}`}></div>
          <span>{connected ? '已连接' : '未连接'}</span>
        </div>
      </header>

      <main className="main">
        <TasksPanel tasks={tasks} />
      </main>

      <aside className="sidebar">
        <AgentsPanel agents={agentsData} history={historyData} recipes={recipesData} />
        <div style={{ marginTop: 20 }}>
          <JarvisStateCard state={stateData} />
        </div>
        <div style={{ marginTop: 20 }}>
          <ActivityFeed events={events} />
        </div>
      </aside>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
