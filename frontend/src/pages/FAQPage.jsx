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

        {/* Updates */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔄 Score updates</h2>
          <div className="faq-card">
            <p className="faq-text">Scores refresh automatically — no need to reload the page.</p>
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
            <p className="faq-note">Data comes from CricAPI. A 1–3 minute delay vs live TV is normal and affects all players equally.</p>
          </div>
        </section>

        {/* Backups */}
        <section className="faq-section">
          <h2 className="faq-section-title">🔁 Backup players</h2>
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
                <tr><td>C/VC transfer</td><td>Multiplier moves to the backup</td></tr>
                <tr><td>No valid backup</td><td>Player scores 0 pts</td></tr>
              </tbody>
            </table>
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
                  <div className="faq-tl-desc">Match appears in the app. Pick from the full 15-player squad. Backups optional.</div>
                </div>
              </div>
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#378ADD'}}></div>
                  <div className="faq-tl-line"></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">Toss <span className="faq-badge faq-badge-blue">~30 min before</span></div>
                  <div className="faq-tl-desc">Playing XI confirmed. Green dots appear on the picker. You can still update your team.</div>
                </div>
              </div>
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#BA7517'}}></div>
                  <div className="faq-tl-line"></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">Match starts <span className="faq-badge faq-badge-amber">first ball</span></div>
                  <div className="faq-tl-desc">Teams locked. Backups auto-swapped. Live scoring begins, leaderboard updates every 60s.</div>
                </div>
              </div>
              <div className="faq-tl-item">
                <div className="faq-tl-left">
                  <div className="faq-tl-dot" style={{background:'#1D9E75'}}></div>
                </div>
                <div className="faq-tl-content">
                  <div className="faq-tl-title">Match ends <span className="faq-badge faq-badge-green">final result</span></div>
                  <div className="faq-tl-desc">Final scores set. Prizes distributed. Podium, full rankings, and basement revealed.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
