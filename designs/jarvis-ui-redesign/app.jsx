/* App Shell — 路由 + 状态 */
function App() {
  const [loggedIn, setLoggedIn] = React.useState(false);
  const [page, setPage] = React.useState('chat');
  const [username, setUsername] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  if (!loggedIn) {
    return <LoginPage onLogin={(name) => { setLoggedIn(true); setUsername(name); }} />;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header page={page} onNav={setPage} username={username} onSettingsOpen={() => setSettingsOpen(true)} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {page === 'chat' && <ChatPage />}
        {page === 'dashboard' && <div style={{ height: '100%', overflow: 'auto' }}><DashboardPage /></div>}
      </div>
      <CredentialsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
