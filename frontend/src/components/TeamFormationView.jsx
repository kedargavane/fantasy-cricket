import './TeamFormationView.css';

// IPL team colour mapping — border + bg
const TEAM_COLOURS = {
  'Mumbai Indians':        { bg: '#0a1628', border: '#004B8E', text: '#6BAED6' },
  'Kolkata Knight Riders': { bg: '#1a0a28', border: '#3A225D', text: '#B39DDB' },
  'Royal Challengers Bengaluru': { bg: '#280a0a', border: '#C8102E', text: '#EF9A9A' },
  'Royal Challengers Bangalore': { bg: '#280a0a', border: '#C8102E', text: '#EF9A9A' },
  'Chennai Super Kings':   { bg: '#282200', border: '#FDB913', text: '#FFF176' },
  'Sunrisers Hyderabad':   { bg: '#281400', border: '#F26522', text: '#FFCC80' },
  'Rajasthan Royals':      { bg: '#200a28', border: '#EA1A8C', text: '#F48FB1' },
  'Delhi Capitals':        { bg: '#00001a', border: '#0078BC', text: '#81D4FA' },
  'Lucknow Super Giants':  { bg: '#001a14', border: '#A5CDCA', text: '#B2DFDB' },
  'Gujarat Titans':        { bg: '#001428', border: '#1C4494', text: '#90CAF9' },
  'Punjab Kings':          { bg: '#280000', border: '#ED1B24', text: '#EF9A9A' },
};

function getTeamColour(teamName) {
  if (!teamName) return { bg: '#111', border: '#222', text: '#555' };
  const key = Object.keys(TEAM_COLOURS).find(k =>
    teamName.toLowerCase().includes(k.toLowerCase().split(' ').slice(-1)[0])
  );
  return key ? TEAM_COLOURS[key] : { bg: '#111', border: '#222', text: '#555' };
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function shortName(name) {
  if (!name) return '';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
}

function PlayerBubble({ player, role, swappedIn, swappedOut, isBackup, unusedBackup }) {
  const colour = getTeamColour(player.team);
  const pts = player.effective_pts ?? player.fantasy_points ?? null;
  const multi = role === 'captain' ? 2 : role === 'vice_captain' ? 1.5 : 1;
  const displayPts = pts !== null ? Math.round(pts * multi) : null;

  const circleStyle = {
    background: colour.bg,
    border: `2px solid ${unusedBackup ? '#222' : colour.border}`,
    borderStyle: unusedBackup ? 'dashed' : 'solid',
    color: unusedBackup ? '#333' : colour.text,
    opacity: swappedOut ? 0.35 : 1,
  };

  return (
    <div className="tfv-player">
      <div className="tfv-circle" style={circleStyle}>
        {initials(player.name)}
        {role === 'captain'      && <span className="tfv-badge tfv-c">C</span>}
        {role === 'vice_captain' && <span className="tfv-badge tfv-v">V</span>}
        {swappedIn               && <span className="tfv-badge tfv-in">↑</span>}
        {unusedBackup            && <span className="tfv-badge tfv-b">B</span>}
      </div>
      <div className="tfv-name">{shortName(player.name)}</div>
      <div className={`tfv-pts ${displayPts > 0 ? 'tfv-pts-active' : unusedBackup || swappedOut ? 'tfv-pts-dim' : ''}`}>
        {unusedBackup ? 'bench' : swappedOut ? '—' : displayPts !== null ? displayPts : '—'}
      </div>
    </div>
  );
}

export default function TeamFormationView({ players = [], swaps = [] }) {
  const swappedInIds  = new Set((swaps || []).map(s => s.swapped_in_player_id));
  const swappedOutIds = new Set((swaps || []).map(s => s.swapped_out_player_id));

  const mains   = players.filter(p => !p.is_backup);
  const backups = players.filter(p => p.is_backup);

  // Group mains by role
  const wk   = mains.filter(p => p.role?.toLowerCase().includes('keeper') || p.role?.toLowerCase() === 'wk' || p.role?.toLowerCase() === 'wicketkeeper');
  const bat  = mains.filter(p => ['bat', 'batsman', 'batter'].includes(p.role?.toLowerCase()));
  const ar   = mains.filter(p => ['ar', 'all-rounder', 'allrounder', 'all rounder'].includes(p.role?.toLowerCase()));
  const bowl = mains.filter(p => ['bowl', 'bowler', 'bow'].includes(p.role?.toLowerCase()));

  // Fallback — any player not matched
  const categorised = new Set([...wk, ...bat, ...ar, ...bowl].map(p => p.id));
  const uncategorised = mains.filter(p => !categorised.has(p.id));

  // Combine bowl + uncategorised
  const bowlers = [...bowl, ...uncategorised];

  // Build legend from unique teams in active players
  const teamSet = {};
  mains.forEach(p => {
    if (p.team && !swappedOutIds.has(p.id)) {
      const c = getTeamColour(p.team);
      const short = p.team.split(' ').slice(-1)[0];
      teamSet[short] = c.border;
    }
  });

  const rows = [
    { label: 'wicketkeeper', players: wk },
    { label: 'batsmen',      players: bat },
    { label: 'all-rounders', players: ar },
    { label: 'bowlers',      players: bowlers },
  ].filter(r => r.players.length > 0);

  return (
    <div className="tfv-field">
      <div className="tfv-inner">
        {rows.map(row => (
          <div key={row.label} className="tfv-section">
            <div className="tfv-row-label">{row.label}</div>
            <div className="tfv-row">
              {row.players.map(p => (
                <PlayerBubble
                  key={p.id}
                  player={p}
                  role={p.role_in_team}
                  swappedIn={swappedInIds.has(p.id)}
                  swappedOut={swappedOutIds.has(p.id)}
                />
              ))}
            </div>
            <div className="tfv-divider" />
          </div>
        ))}

        {backups.length > 0 && (
          <div className="tfv-backup-section">
            <div className="tfv-backup-label">backups</div>
            <div className="tfv-row">
              {backups.map(p => (
                <PlayerBubble
                  key={p.id}
                  player={p}
                  role={swappedInIds.has(p.id) ? p.role_in_team : null}
                  swappedIn={swappedInIds.has(p.id)}
                  unusedBackup={!swappedInIds.has(p.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {Object.keys(teamSet).length > 0 && (
        <div className="tfv-legend">
          {Object.entries(teamSet).map(([name, colour]) => (
            <span key={name} className="tfv-leg-item">
              <span className="tfv-leg-dot" style={{ background: colour }} />
              {name}
            </span>
          ))}
          <span className="tfv-leg-item">
            <span className="tfv-leg-dot" style={{ background: '#1d9e75' }} />
            Swapped in
          </span>
        </div>
      )}
    </div>
  );
}
