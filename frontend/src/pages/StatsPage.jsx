import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const TEAM_COLORS = {
  'AIML 11':           '#1D9E75',
  'Full Tossers':      '#378ADD',
  'Maisu':             '#BA7517',
  'Fish Fry Fotshots': '#D85A30',
  'EPSILON':           '#6B3FD4',
  'Raight Choicers':   '#C08000',
  'PamPam Khiladi':    '#8899BB',
};

function rankDotColor(r, total) {
  if (!r) return null;
  if (r === 1) return '#1D9E75';
  if (r <= 3)  return '#6BAED6';
  if (r >= total - 1) return '#D85A30';
  return '#d8ddf0';
}
function rankTextColor(r, total) {
  if (!r) return '#ccc';
  if (r === 1 || r >= total - 1) return '#fff';
  if (r <= 3) return '#fff';
  return '#4a5a7a';
}
function winBarColor(pct) {
  if (pct >= 80) return '#1D9E75';
  if (pct >= 50) return '#6BAED6';
  return '#D85A30';
}
function unitsColor(u) {
  if (u >= 1200)  return { bg: '#085041', tc: '#9FE1CB' };
  if (u >= 600)   return { bg: '#1D9E75', tc: '#fff' };
  if (u >= 100)   return { bg: '#5DCAA5', tc: '#04342C' };
  if (u >= -100)  return { bg: '#E1F5EE', tc: '#0F6E56' };
  if (u >= -600)  return { bg: '#F0997B', tc: '#4A1B0C' };
  if (u >= -1200) return { bg: '#D85A30', tc: '#fff' };
  return { bg: '#993C1D', tc: '#FAECE7' };
}

function getSegments(ranks, total) {
  const segments = [];
  let i = 0;
  while (i < ranks.length) {
    const r = ranks[i];
    if (r !== null && r <= 3) {
      let j = i, count = 0;
      while (j < ranks.length) {
        if (ranks[j] === null) { j++; continue; }
        if (ranks[j] <= 3) { count++; j++; } else break;
      }
      if (count >= 3) { segments.push({ type: 'hot', from: i, to: j - 1 }); i = j; continue; }
    }
    if (r !== null && r >= total - 1) {
      let j = i, count = 0;
      while (j < ranks.length) {
        if (ranks[j] === null) { j++; continue; }
        if (ranks[j] >= total - 1) { count++; j++; } else break;
      }
      if (count >= 3) { segments.push({ type: 'cold', from: i, to: j - 1 }); i = j; continue; }
    }
    segments.push({ type: 'normal', from: i, to: i });
    i++;
  }
  return segments;
}

function getCurrentForm(ranks, total) {
  const last3 = ranks.filter(r => r !== null).slice(-3);
  if (last3.length < 3) return 'neutral';
  if (last3.every(r => r <= 3)) return 'hot';
  if (last3.every(r => r >= total - 1)) return 'cold';
  return 'neutral';
}

export default function StatsPage() {
  const navigate = useNavigate();
  const { seasons, activeSeason } = useAuth();
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Default to activeSeason on first load
  useEffect(() => {
    if (!selectedSeason && activeSeason) setSelectedSeason(activeSeason);
  }, [activeSeason]);

  useEffect(() => {
    if (!selectedSeason) return;
    setLoading(true);
    setError(null);
    api.get(`/leaderboard/season/${selectedSeason.id}/stats`)
      .then(res => setData(res.data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedSeason]);

  if (!selectedSeason && !activeSeason) return <div style={{padding:32,textAlign:'center',color:'var(--text-muted)'}}>No season selected</div>;
  if (loading) return <div style={{padding:32,textAlign:'center',color:'var(--text-muted)'}}>Loading...</div>;
  if (error)   return <div style={{padding:32,color:'red'}}>Error: {error}</div>;
  if (!data)   return <div style={{padding:32,textAlign:'center',color:'var(--text-muted)'}}>No data</div>;

  const { matches, ranksByTeam, unitsByIpl, capContrib, capPicks, totalMatches } = data;
  const matchIds   = matches.map(m => m.id);
  const teams      = Object.keys(ranksByTeam).filter(t => t !== 'The Gunners');
  const totalTeams = teams.length;
  const iplTeams   = Object.keys(unitsByIpl).sort();
  const iplShort   = {
    'Chennai Super Kings':'CSK','Delhi Capitals':'DC','Gujarat Titans':'GT',
    'Kolkata Knight Riders':'KKR','Lucknow Super Giants':'LSG','Mumbai Indians':'MI',
    'Punjab Kings':'PBKS','Rajasthan Royals':'RR','Royal Challengers Bengaluru':'RCB',
    'Sunrisers Hyderabad':'SRH',
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg-base)',paddingBottom:80}}>

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 16px',background:'var(--bg-surface)',borderBottom:'0.5px solid var(--border)',position:'sticky',top:0,zIndex:10}}>
        <button onClick={() => navigate(-1)} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--text-secondary)',padding:0}}>‹</button>
        <span style={{fontSize:15,fontWeight:600,color:'var(--text-primary)',flex:1}}>Stats</span>
        {seasons.length > 1 && (
          <select
            value={selectedSeason?.id || ''}
            onChange={e => setSelectedSeason(seasons.find(s => s.id === parseInt(e.target.value)))}
            style={{fontSize:12,padding:'3px 6px',borderRadius:6,border:'0.5px solid var(--border)',background:'var(--bg-elevated)',color:'var(--text-primary)',cursor:'pointer'}}
          >
            {[...seasons].sort((a,b) => b.id - a.id).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <span style={{fontSize:11,color:'var(--text-muted)'}}>{totalMatches} matches</span>
      </div>

      <div style={{padding:16,display:'flex',flexDirection:'column',gap:20,maxWidth:700,margin:'0 auto'}}>

        {/* ── Form Chart ── */}
        <section>
          <div style={{fontSize:14,fontWeight:600,color:'var(--text-primary)',marginBottom:3}}>Match by Match Form</div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:8}}>Each dot = one match · 🔥 3+ top-3 streak · ❄️ 3+ bottom-2 streak</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8,fontSize:11,color:'var(--text-secondary)'}}>
            {[['#1D9E75','#1'],['#6BAED6','top 3'],['#d8ddf0','mid'],['#D85A30','bottom']].map(([c,l]) => (
              <span key={l} style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{width:12,height:12,borderRadius:'50%',background:c,display:'inline-block'}}/>
                {l}
              </span>
            ))}
          </div>
          <div style={{background:'var(--bg-surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
            {teams.map((team, ti) => {
              const color = TEAM_COLORS[team] || '#888';
              const ranks = matchIds.map(mid => ranksByTeam[team]?.[mid] ?? null);
              const segments = getSegments(ranks, totalTeams);
              const form = getCurrentForm(ranks, totalTeams);
              const badgeStyle = form === 'hot'
                ? {background:'#FF4D0015',color:'#FF4D00',border:'1px solid #FF4D00'}
                : form === 'cold'
                ? {background:'#1A6FD415',color:'#1A6FD4',border:'1px solid #1A6FD4'}
                : {background:'var(--bg-elevated)',color:'var(--text-muted)',border:'1px solid var(--border)'};
              return (
                <div key={team} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderBottom:ti<teams.length-1?'0.5px solid var(--border)':'none'}}>
                  <div style={{fontSize:11,fontWeight:500,color:'var(--text-primary)',width:100,flexShrink:0,borderLeft:`3px solid ${color}`,paddingLeft:7,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{team}</div>
                  <div style={{display:'flex',alignItems:'center',gap:3,flex:1,flexWrap:'wrap'}}>
                    {segments.map((seg, si) => {
                      const isHot = seg.type === 'hot', isCold = seg.type === 'cold';
                      const segRanks = ranks.slice(seg.from, seg.to + 1);
                      return (
                        <div key={si} style={{display:'flex',alignItems:'center',gap:2,background:isHot?'#FF4D0010':isCold?'#1A6FD410':'transparent',border:isHot?'1.5px dashed #FF4D00':isCold?'1.5px dashed #1A6FD4':'none',borderRadius:(isHot||isCold)?7:0,padding:(isHot||isCold)?'2px 3px':0}}>
                          {(isHot||isCold)&&<span style={{fontSize:9}}>{isHot?'🔥':'❄️'}</span>}
                          {segRanks.map((r,ri) => {
                            const bg = rankDotColor(r,totalTeams), tc = rankTextColor(r,totalTeams);
                            return r===null
                              ? <div key={ri} style={{width:17,height:17,borderRadius:'50%',border:'1.5px dashed #ddd',flexShrink:0}}/>
                              : <div key={ri} style={{width:17,height:17,borderRadius:'50%',background:bg,color:tc,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:700,flexShrink:0}}>{r}</div>;
                          })}
                        </div>
                      );
                    })}
                  </div>
                  <span style={{fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:20,flexShrink:0,...badgeStyle}}>{form==='hot'?'🔥 Hot':form==='cold'?'❄️ Cold':'Steady'}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Units Heatmap ── */}
        <section>
          <div style={{fontSize:14,fontWeight:600,color:'var(--text-primary)',marginBottom:3}}>Net Units by IPL Team</div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:8}}>Units won − 300 entry · bottom row = avg rank</div>
          <div style={{overflowX:'auto'}}>
            <div style={{display:'grid',gridTemplateColumns:`90px repeat(${iplTeams.length},1fr)`,fontSize:10,background:'var(--bg-surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden',minWidth:500}}>
              <div style={{padding:'6px 8px',background:'var(--bg-elevated)',borderBottom:'0.5px solid var(--border)'}}/>
              {iplTeams.map(ipl => (
                <div key={ipl} style={{padding:'6px 2px',textAlign:'center',background:'var(--bg-elevated)',borderBottom:'0.5px solid var(--border)',borderLeft:'0.5px solid var(--border)',fontWeight:600,color:'var(--text-secondary)'}}>{iplShort[ipl]||ipl.slice(0,3)}</div>
              ))}
              {teams.map((team,ti) => {
                const color = TEAM_COLORS[team]||'#888';
                const isLast = ti===teams.length-1;
                return [
                  <div key={team+'-n'} style={{padding:'6px 6px 6px 9px',borderBottom:isLast?'none':'0.5px solid var(--border)',borderLeft:`3px solid ${color}`,fontSize:10,fontWeight:500,color:'var(--text-primary)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{team.split(' ')[0]}</div>,
                  ...iplTeams.map(ipl => {
                    const d = unitsByIpl[ipl]?.[team];
                    const u = d?.units??null;
                    const {bg,tc} = u!==null?unitsColor(u):{bg:'var(--bg-elevated)',tc:'var(--text-muted)'};
                    const sign = u!==null&&u>=0?'+':'';
                    const avgRank = d?.ranks?.length?(d.ranks.reduce((a,b)=>a+b,0)/d.ranks.length).toFixed(1):'—';
                    return (
                      <div key={ipl} style={{padding:'4px 2px',textAlign:'center',background:bg,color:tc,borderBottom:isLast?'none':'0.5px solid var(--border)',borderLeft:'0.5px solid var(--border)'}}>
                        {u!==null?<><div style={{fontWeight:600,fontSize:10}}>{sign}{u}</div><div style={{fontSize:9,opacity:0.75}}>r{avgRank}</div></>:<span style={{color:'var(--text-muted)'}}>—</span>}
                      </div>
                    );
                  })
                ];
              })}
            </div>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:6,fontSize:11,color:'var(--text-secondary)'}}>
            {[['#085041','big win'],['#1D9E75','profit'],['#E1F5EE','~zero'],['#D85A30','loss'],['#993C1D','big loss']].map(([bg,label]) => (
              <span key={label} style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:24,height:8,background:bg,borderRadius:2,display:'inline-block'}}/>{label}</span>
            ))}
          </div>
        </section>

        {/* ── Captain Contribution ── */}
        <section>
          <div style={{fontSize:14,fontWeight:600,color:'var(--text-primary)',marginBottom:3}}>Captain & VC Contribution</div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:8}}>Avg % of total fantasy points · avg pts/match on right</div>
          <div style={{background:'var(--bg-surface)',border:'0.5px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
            {[...capContrib].filter(r=>r.team_name!=='The Gunners').sort((a,b)=>b.avg_total-a.avg_total).map((row,ri,arr) => {
              const total = row.avg_total||1;
              const capPct  = Math.round(Math.min((row.avg_cap/total)*100, 35));
              const vcPct   = Math.round(Math.min((row.avg_vc/total)*100,  25));
              const othPct  = 100-capPct-vcPct;
              const color   = TEAM_COLORS[row.team_name]||'#888';
              return (
                <div key={row.team_name} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderBottom:ri<arr.length-1?'0.5px solid var(--border)':'none'}}>
                  <div style={{fontSize:11,fontWeight:500,color:'var(--text-primary)',width:105,flexShrink:0,borderLeft:`3px solid ${color}`,paddingLeft:7,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{row.team_name}</div>
                  <div style={{flex:1,height:20,display:'flex',borderRadius:4,overflow:'hidden'}}>
                    <div style={{width:`${capPct}%`,background:'#1D9E75',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'#fff'}}>{capPct>8?`${capPct}%`:''}</div>
                    <div style={{width:`${vcPct}%`,background:'#BA7517',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'#fff'}}>{vcPct>6?`${vcPct}%`:''}</div>
                    <div style={{width:`${othPct}%`,background:'#378ADD',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'#fff'}}>{othPct>8?`${othPct}%`:''}</div>
                  </div>
                  <div style={{fontSize:11,fontWeight:500,color:'var(--text-primary)',width:52,textAlign:'right',flexShrink:0}}>{Math.round(row.avg_total)}pts</div>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:6,fontSize:11,color:'var(--text-secondary)'}}>
            {[['#1D9E75','Captain (2×)'],['#BA7517','VC (1.5×)'],['#378ADD','Rest']].map(([c,l]) => (
              <span key={l} style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:12,height:12,background:c,borderRadius:2,display:'inline-block'}}/>{l}</span>
            ))}
          </div>
        </section>

        {/* ── Captain Report Card ── */}
        <section>
          <div style={{fontSize:14,fontWeight:600,color:'var(--text-primary)',marginBottom:3}}>Captain & VC Report Card</div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:10}}>Top picks · win% = top-3 finish rate · avg pts with multiplier</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:10}}>
            {teams.map(team => {
              const d = capPicks[team];
              if (!d) return null;
              const color = TEAM_COLORS[team]||'#888';
              return (
                <div key={team} style={{background:'var(--bg-surface)',border:'0.5px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--text-primary)',marginBottom:10,borderLeft:`3px solid ${color}`,paddingLeft:8}}>{team}</div>
                  {[['CAPTAIN',d.caps],['VICE CAPTAIN',d.vcs]].map(([label,picks],li) => (
                    <div key={label}>
                      {li===1&&<div style={{height:'0.5px',background:'var(--border)',margin:'8px 0'}}/>}
                      <div style={{fontSize:9,fontWeight:600,letterSpacing:'0.08em',color:'var(--text-muted)',marginBottom:6}}>{label}</div>
                      {picks.map((p,i) => (
                        <div key={i} style={{display:'flex',alignItems:'center',gap:5,marginBottom:4}}>
                          <span style={{fontSize:10,color:'var(--text-muted)',width:20,flexShrink:0}}>{p.count}×</span>
                          <span style={{fontSize:11,color:'var(--text-primary)',flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name}</span>
                          <div style={{width:55,height:6,background:'var(--bg-elevated)',borderRadius:3,flexShrink:0}}>
                            <div style={{height:'100%',width:`${p.winPct}%`,background:winBarColor(p.winPct),borderRadius:3}}/>
                          </div>
                          <span style={{fontSize:10,fontWeight:600,width:32,textAlign:'right',flexShrink:0,color:winBarColor(p.winPct)}}>{p.winPct}%</span>
                          <span style={{fontSize:10,color:'var(--text-muted)',width:38,textAlign:'right',flexShrink:0}}>{p.avgPts}pts</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
