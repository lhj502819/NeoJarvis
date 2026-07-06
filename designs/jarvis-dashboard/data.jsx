const API_BASE = 'http://localhost:3000';

function usePolling(url, interval = 3000) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}${url}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (active) { setData(json); setError(null); }
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    fetchData();
    const id = setInterval(fetchData, interval);
    return () => { active = false; clearInterval(id); };
  }, [url, interval]);

  return { data, error };
}

function useSSE(url) {
  const [events, setEvents] = React.useState([]);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let buffer = '';

    const connect = async () => {
      try {
        const res = await fetch(`${API_BASE}${url}`);
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6);
            if (raw === '[DONE]') continue;
            try {
              const event = JSON.parse(raw);
              if (event.type !== 'connected') {
                setEvents(prev => [...prev.slice(-50), { ...event, _ts: Date.now() }]);
              }
            } catch {}
          }
        }
      } catch {
        setConnected(false);
        if (active) setTimeout(connect, 3000);
      }
    };

    connect();
    return () => { active = false; };
  }, [url]);

  return { events, connected };
}

Object.assign(window, { usePolling, useSSE, API_BASE });
