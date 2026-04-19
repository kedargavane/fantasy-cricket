import { useNavigate } from 'react-router-dom';
import './FAQPage.css';

export default function FAQPage() {
  const navigate = useNavigate();
  return (
    <div className="faq-page">
      <div className="faq-header">
        <button className="faq-back" onClick={() => navigate(-1)}>‹</button>
        <span className="faq-title">How it works</span>
      </div>

      <div className="faq-body">

        {/* Scoring */}
        <section className="faq-section">
          <h2 className="faq-section-title">🏏 Scoring system</h2>
          <div className="faq-card">
            <p className="faq-text">Points are calculated from your players' actual match performances. Captain and Vice Captain multipliers apply on top of base points.</p>
            <div className="faq-mult-grid">
              <div className="faq-mult-card">
                <span className="faq-mult-num faq-green">2×</span>
                <span className="faq-mult-label">Captain</span>
              </div>
              <div className="faq-mult-card">
                <span className="faq-mult-num faq-blue">1.5×</span>
                <span className="faq-mult-label">Vice Captain</span>
              </div>
            </div>
          </div>

          <div className="faq-card">
            <div className="faq-table-label">Batting</div>
            <table className="faq-table">
              <thead><tr><th>Event</th><th>Pts</th></tr></thead>
              <tbody>
                <tr><td>Playing in the XI</td><td className="pos">+4</td></tr>
                <tr><td>Per run scored</td><td className="pos">+1</td></tr>
                <tr><td>Boundary (4)</td><td className="pos">+1</td></tr>
                <tr><td>Six (6)</td><td className="pos">+2</td></tr>
                <tr><td>Half century (50–99)</td><td className="pos">+8</td></tr>
                <tr><td>Century (100+)</td><td className="pos">+16</td></tr>
                <tr><td>Duck (dismissed for 0)</td><td className="neg">−2</td></tr>
                <tr><td>SR &gt;170 (min 10 balls)</td><td className="pos">+6</td></tr>
                <tr><td>SR 150–170</td><td className="pos">+4</td></tr>
                <tr><td>SR 130–150</td><td className="pos">+2</td></tr>
                <tr><td>SR 60–70</td><td className="neg">−2</td></tr>
                <tr><td>SR &lt;60</td><td className="neg">−4</td></tr>
              </tbody>
            </table>
          </div>

          <div className="faq-card">
            <div className="faq-table-label">Bowling</div>
            <table className="faq-table">
              <thead><tr><th>Event</th><th>Pts</th></tr></thead>
              <tbody>
                <tr><td>Per wicket</td><td className="pos">+25</td></tr>
                <tr><td>LBW / bowled bonus</td><td className="pos">+8</td></tr>
                <tr><td>3-wicket haul</td><td className="pos">+4</td></tr>
                <tr><td>4-wicket haul</td><td className="pos">+8</td></tr>
                <tr><td>5-wicket haul</td><td className="pos">+16</td></tr>
                <tr><td>Maiden over</td><td className="pos">+8</td></tr>
                <tr><td>Economy &lt;6 (min 2 ov)</td><td className="pos">+6</td></tr>
                <tr><td>Economy 6–7</td><td className="pos">+4</td></tr>
                <tr><td>Economy 7–8</td><td className="pos">+2</td></tr>
                <tr><td>Economy 10–11</td><td className="neg">−2</td></tr>
                <tr><td>Economy &gt;11</td><td className="neg">−4</td></tr>
              </tbody>
            </table>
          </div>

          <div className="faq-card">
            <div className="faq-table-label">Fielding</div>
            <table className="faq-table">
              <thead><tr><th>Event</th><th>Pts</th></tr></thead>
              <tbody>
                <tr><td>Catch</td><td className="pos">+8</td></tr>
                <tr><td>Stumping</td><td className="pos">+12</td></tr>
                <tr><td>Run out</td><td className="pos">+10</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Score updates */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔄 Score updates</h2>
          <div className="faq-card">
            <p className="faq-text">Scores refresh automatically — no need to reload the page. Use the Refresh button on the leaderboard tab to pull the latest data manually.</p>
            <div className="faq-update-rows">
              <div className="faq-update-row">
                <span className="faq-update-label">Live match</span>
                <div className="faq-bar-track"><div className="faq-bar-fill" style={{width:'100%',background:'var(--accent-green)'}}></div></div>
                <span className="faq-update-val">every 60s</span>
              </div>
              <div className="faq-update-row">
                <span className="faq-update-label">Pre-match XI</span>
                <div className="faq-bar-track"><div className="faq-bar-fill" style={{width:'60%',background:'var(--accent-primary)'}}></div></div>
                <span className="faq-update-val">every 5 min</span>
              </div>
              <div className="faq-update-row">
                <span className="faq-update-label">Final scores</span>
                <div className="faq-bar-track"><div className="faq-bar-fill" style={{width:'25%',background:'var(--text-muted)'}}></div></div>
                <span className="faq-update-val">post match</span>
              </div>
            </div>
            <p className="faq-note">Data comes from Sportmonks. A 1–3 minute delay vs live TV is normal and affects all players equally.</p>
          </div>
        </section>

        {/* Backups & swaps */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔁 Backup players & auto-swap</h2>
          <div className="faq-card">
            <p className="faq-text">Pick up to 2 backup players. If a main player misses the Playing XI, your backup automatically replaces them at match start.</p>
            <div className="faq-swap-flow">
              <div className="faq-swap-box">
                <div className="faq-swap-role">Main player</div>
                <div className="faq-swap-name">Wasim Jr</div>
                <div className="faq-swap-status faq-red">Not playing</div>
              </div>
              <div className="faq-swap-arrow">→</div>
              <div className="faq-swap-box">
                <div className="faq-swap-role">Replaced by</div>
                <div className="faq-swap-name">Litton Das</div>
                <div className="faq-swap-status faq-green">In XI</div>
              </div>
            </div>
            <table className="faq-table" style={{marginTop:14}}>
              <tbody>
                <tr><td>Backups are optional</td><td>0, 1, or 2</td></tr>
                <tr><td>Swap order</td><td>Backup 1 first, then Backup 2</td></tr>
                <tr><td>C/VC transfer</td><td>Multiplier moves to backup</td></tr>
                <tr><td>No valid backup</td><td>Player scores 0 pts</td></tr>
                <tr><td>Both main and backup out</td><td>No swap, 0 pts</td></tr>
                <tr><td>Impact sub as backup</td><td>Still counts — swapped in</td></tr>
              </tbody>
            </table>
            <p className="faq-note" style={{marginTop:10}}>You get a push notification after the XI is announced telling you whether a swap was applied or all your players are in.</p>
          </div>
        </section>

        {/* Impact substitutes */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔀 Impact substitutes</h2>
          <div className="faq-card">
            <p className="faq-text">IPL allows impact substitutes — a player who comes on after the match starts. In the picker, impact subs are shown with an amber dot.</p>
            <table className="faq-table" style={{marginTop:10}}>
              <tbody>
                <tr><td>Impact sub in your main XI</td><td>Earns points normally</td></tr>
                <tr><td>Impact sub as your backup</td><td>Can still be swapped in</td></tr>
                <tr><td>Your pick replaced by impact sub</td><td>No effect — pick still plays</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Player stats */}
        <section className="faq-section">
          <h2 className="faq-section-title">📊 Player stats on picker</h2>
          <div className="faq-card">
            <p className="faq-text">The picker shows each player's season total points and average directly under their name — so you can make informed picks without leaving the page.</p>
            <table className="faq-table" style={{marginTop:10}}>
              <tbody>
                <tr><td>Tap a player name</td><td>Opens full season stats</td></tr>
                <tr><td>Stats shown</td><td>Total pts, avg, best, last 5 matches</td></tr>
                <tr><td>Sort button</td><td>Sort both columns by season pts</td></tr>
                <tr><td>New players (0 pts)</td><td>Haven't played yet this season</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Team view */}
        <section className="faq-section">
          <h2 className="faq-section-title">🗺 Team visual view</h2>
          <div className="faq-card">
            <p className="faq-text">Tap any team on the leaderboard to see their players. Switch between List view (detailed scores) and Visual view (formation layout grouped by role).</p>
            <table className="faq-table" style={{marginTop:10}}>
              <tbody>
                <tr><td>Visual view</td><td>WK → Bat → AR → Bowl → Backups</td></tr>
                <tr><td>IPL team colours</td><td>Circle colour = player's franchise</td></tr>
                <tr><td>Green ↑ badge</td><td>Backup was swapped in</td></tr>
                <tr><td>Dashed circle</td><td>Unused backup</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Compare */}
        <section className="faq-section">
          <h2 className="faq-section-title">⚡ Compare teams</h2>
          <div className="faq-card">
            <p className="faq-text">The Compare tab shows two teams side by side. Players are grouped into Common (both picked) and Unique (only one team picked them).</p>
            <table className="faq-table" style={{marginTop:10}}>
              <tbody>
                <tr><td>Common players</td><td>Same pick, different roles/pts</td></tr>
                <tr><td>Unique players</td><td>Where the match is won or lost</td></tr>
                <tr><td>Swapped out</td><td>Faded with OUT badge — 0 pts</td></tr>
                <tr><td>↑ badge</td><td>Backup swapped in — earns real pts</td></tr>
                <tr><td>B badge</td><td>Unused backup</td></tr>
                <tr><td>Backups section</td><td>Shown at bottom for both teams</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Notifications */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔔 Push notifications</h2>
          <div className="faq-card">
            <p className="faq-text">Enable push notifications in Settings to get real-time alerts. On iPhone you must add the app to your Home Screen first.</p>
            <table className="faq-table" style={{marginTop:10}}>
              <tbody>
                <tr><td>Playing XI announced</td><td>Know who's in before lock</td></tr>
                <tr><td>Swap update</td><td>Which backup came in (or didn't)</td></tr>
                <tr><td>Rank injection</td><td>Alert when you drop 2+ ranks live</td></tr>
                <tr><td>Match result</td><td>Your final rank and units won/lost</td></tr>
              </tbody>
            </table>
            <p className="faq-note" style={{marginTop:10}}>iPhone: Safari → Share → Add to Home Screen → open from Home Screen → Settings → Enable Push Notifications.</p>
          </div>
        </section>

        {/* Season standings */}
        <section className="faq-section">
          <h2 className="faq-section-title">🏆 Season standings</h2>
          <div className="faq-card">
            <p className="faq-text">The season leaderboard ranks players by net units won across all matches. A minimum number of matches must be played to be eligible for a ranking.</p>
            <table className="faq-table" style={{marginTop:10}}>
              <tbody>
                <tr><td>Ranked by</td><td>Net units → total fantasy pts</td></tr>
                <tr><td>Eligibility</td><td>Min 25% of matches played</td></tr>
                <tr><td>Abandoned matches</td><td>Not counted — no units deducted</td></tr>
                <tr><td>Entry cost</td><td>300u per match</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Picker symbols */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔣 Picker symbols guide</h2>
          <div style={{display:'flex',flexDirection:'column',gap:0}}>

            <p className="faq-subhead" style={{color:'var(--text-muted)',fontSize:'0.7rem',fontWeight:600,letterSpacing:'0.08em',marginBottom:8,marginTop:4}}>SELECTION</p>
            {[
              { badge: <span style={{width:28,height:28,borderRadius:6,background:'var(--bg-elevated)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--accent-primary)',fontSize:18,flexShrink:0}}>+</span>, label: 'Add to Main XI', desc: 'Tap to select as one of your 11 main players' },
              { badge: <span style={{width:28,height:28,borderRadius:6,background:'var(--bg-elevated)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--accent-gold)',fontSize:13,fontWeight:700,flexShrink:0}}>B</span>, label: 'Add as Backup', desc: 'Auto-replaces a non-playing main player at toss' },
              { badge: <span style={{width:28,height:28,borderRadius:6,background:'var(--bg-elevated)',border:'1px solid var(--accent-green)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--accent-green)',fontSize:11,fontWeight:700,flexShrink:0}}>B✓</span>, label: 'Backup selected', desc: 'Player confirmed as your backup' },
            ].map((item, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                {item.badge}
                <div>
                  <div style={{fontSize:'0.85rem',fontWeight:500}}>{item.label}</div>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{item.desc}</div>
                </div>
              </div>
            ))}

            <p className="faq-subhead" style={{color:'var(--text-muted)',fontSize:'0.7rem',fontWeight:600,letterSpacing:'0.08em',marginBottom:8,marginTop:16}}>CAPTAIN & VICE CAPTAIN</p>
            {[
              { badge: <span style={{width:28,height:28,borderRadius:'50%',background:'#f5a623',display:'flex',alignItems:'center',justifyContent:'center',color:'#412402',fontSize:13,fontWeight:700,flexShrink:0}}>C</span>, label: 'Captain · 2× points', desc: 'All fantasy points doubled for this player' },
              { badge: <span style={{width:28,height:28,borderRadius:'50%',background:'var(--accent-primary)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:11,fontWeight:700,flexShrink:0}}>VC</span>, label: 'Vice Captain · 1.5× points', desc: '50% bonus added to all fantasy points' },
            ].map((item, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                {item.badge}
                <div>
                  <div style={{fontSize:'0.85rem',fontWeight:500}}>{item.label}</div>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{item.desc}</div>
                </div>
              </div>
            ))}

            <p className="faq-subhead" style={{color:'var(--text-muted)',fontSize:'0.7rem',fontWeight:600,letterSpacing:'0.08em',marginBottom:8,marginTop:16}}>PLAYER STATUS</p>
            {[
              { badge: <span style={{width:10,height:10,borderRadius:'50%',background:'var(--accent-primary)',display:'inline-block',flexShrink:0,margin:'0 9px'}} />, label: 'Playing XI confirmed', desc: 'Player is in the playing 11 — confirmed after toss' },
              { badge: <span style={{width:10,height:10,borderRadius:'50%',background:'var(--accent-gold)',display:'inline-block',flexShrink:0,margin:'0 9px'}} />, label: 'Impact substitute', desc: 'Player is an IPL impact sub — still earns points' },
              { badge: <span style={{width:10,height:10,borderRadius:'50%',border:'1.5px solid var(--border-strong)',display:'inline-block',flexShrink:0,margin:'0 9px'}} />, label: 'Not yet confirmed', desc: 'Playing XI not announced or player not selected' },
            ].map((item, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                {item.badge}
                <div>
                  <div style={{fontSize:'0.85rem',fontWeight:500}}>{item.label}</div>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{item.desc}</div>
                </div>
              </div>
            ))}

            <p className="faq-subhead" style={{color:'var(--text-muted)',fontSize:'0.7rem',fontWeight:600,letterSpacing:'0.08em',marginBottom:8,marginTop:16}}>DURING MATCH (SWAPS)</p>
            {[
              { badge: <span style={{padding:'2px 6px',borderRadius:3,background:'rgba(26,138,74,0.15)',color:'var(--accent-green)',fontSize:'0.65rem',fontWeight:700,flexShrink:0}}>↑IN</span>, label: 'Backup swapped in', desc: 'This backup replaced a non-playing main player' },
              { badge: <span style={{padding:'2px 6px',borderRadius:3,background:'rgba(212,32,32,0.12)',color:'var(--accent-red)',fontSize:'0.65rem',fontWeight:700,flexShrink:0}}>OUT</span>, label: 'Swapped out', desc: 'This player was not in the XI — replaced by backup' },
            ].map((item, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom: i===0 ? '1px solid var(--border)' : 'none'}}>
                {item.badge}
                <div>
                  <div style={{fontSize:'0.85rem',fontWeight:500}}>{item.label}</div>
                  <div style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Timeline */}
        <section className="faq-section">
          <h2 className="faq-section-title">📅 Order of events</h2>
          <div className="faq-card">
            <div className="faq-timeline">
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#7F77DD'}}></div>
                  <div className="faq-tl-line"></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">Match announced <span className="faq-badge faq-badge-purple">days before</span></div>
                  <div className="faq-tl-desc">Match appears in the app. Pick from the full squad. Backups optional. Player season stats visible on picker.</div>
                </div>
              </div>
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#378ADD'}}></div>
                  <div className="faq-tl-line"></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">XI announced <span className="faq-badge faq-badge-blue">~30 min before</span></div>
                  <div className="faq-tl-desc">Playing XI confirmed. Blue dots appear on picker. Push notification sent. Impact subs shown with amber dot. You can still update your team.</div>
                </div>
              </div>
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#BA7517'}}></div>
                  <div className="faq-tl-line"></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">Match starts <span className="faq-badge faq-badge-amber">first ball</span></div>
                  <div className="faq-tl-desc">Teams locked. Backups auto-swapped. Push notification confirms your swap. Live scoring begins, leaderboard updates every 60s.</div>
                </div>
              </div>
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#1D9E75'}}></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">Match ends <span className="faq-badge faq-badge-green">final result</span></div>
                  <div className="faq-tl-desc">Final scores set. Push notification with your rank and units. Prizes distributed. Season standings updated.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
