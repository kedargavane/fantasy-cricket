#!/usr/bin/env node
'use strict';

/**
 * SEED SCRIPT — Test Season Setup
 *
 * Creates:
 *  - Admin user
 *  - 1 active season: "LLC 2026 Test League"
 *  - 3 completed past matches (with realistic scores and prizes)
 *  - 1 upcoming match: today's Mumbai Spartans vs India Tigers
 *  - 4 test user accounts to make it look like a real league
 *
 * Usage:
 *   node scripts/seed.js
 *   node scripts/seed.js --reset   (drops and recreates everything)
 *
 * Run this on Railway via: railway run node scripts/seed.js
 */

require('dotenv').config();
const bcrypt  = require('bcryptjs');
const { initDb, getDb } = require('../src/db/database');

const RESET = process.argv.includes('--reset');

initDb();
const db = getDb();

if (RESET) {
  console.log('Resetting all data...');
  [
    'prize_distributions','match_prize_pools','user_team_swaps',
    'user_team_players','user_teams','player_match_stats',
    'match_squads','match_config','matches','season_leaderboard',
    'season_memberships','seasons','push_subscriptions','players','users',
  ].forEach(t => db.prepare(`DELETE FROM ${t}`).run());
  console.log('Reset done.\n');
}

// ── 1. Create users ───────────────────────────────────────────────────────────
console.log('Creating users...');

const users = [
  { name: 'Admin',    email: 'admin@test.com',   password: 'password123', isAdmin: 1 },
  { name: 'Rahul',    email: 'rahul@test.com',    password: 'password123', isAdmin: 0 },
  { name: 'Priya',    email: 'priya@test.com',    password: 'password123', isAdmin: 0 },
  { name: 'Karthik',  email: 'karthik@test.com',  password: 'password123', isAdmin: 0 },
  { name: 'Sneha',    email: 'sneha@test.com',    password: 'password123', isAdmin: 0 },
];

const userIds = {};
for (const u of users) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
  if (existing) { userIds[u.email] = existing.id; continue; }
  const hash = bcrypt.hashSync(u.password, 10);
  const r = db.prepare('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?,?,?,?)').run(u.name, u.email, hash, u.isAdmin);
  userIds[u.email] = r.lastInsertRowid;
  console.log(`  Created: ${u.name} (${u.email})`);
}

// ── 2. Create season ──────────────────────────────────────────────────────────
console.log('\nCreating season...');

let seasonId;
const existingSeason = db.prepare("SELECT id FROM seasons WHERE invite_code = 'LLC2026'").get();
if (existingSeason) {
  seasonId = existingSeason.id;
  console.log('  Season already exists, id:', seasonId);
} else {
  const r = db.prepare(`
    INSERT INTO seasons (name, year, status, invite_code, admin_user_id, max_players, series_ids)
    VALUES (?,?,?,?,?,?,?)
  `).run('LLC 2026 Test League', 2026, 'active', 'LLC2026', userIds['admin@test.com'], 20, '[]');
  seasonId = r.lastInsertRowid;
  console.log('  Created season id:', seasonId);
}

// Add all users to season
for (const email of Object.keys(userIds)) {
  try {
    db.prepare('INSERT INTO season_memberships (season_id, user_id) VALUES (?,?)').run(seasonId, userIds[email]);
    db.prepare('INSERT OR IGNORE INTO season_leaderboard (season_id, user_id) VALUES (?,?)').run(seasonId, userIds[email]);
  } catch { /* already member */ }
}
console.log('  All users joined season');

// ── 3. Create players pool ────────────────────────────────────────────────────
console.log('\nCreating players...');

const players = [
  // India Tigers
  { name: 'Chris Gayle',          team: 'India Tigers',    role: 'batsman',       pid: 'gayle-001' },
  { name: 'Robin Uthappa',        team: 'India Tigers',    role: 'wicketkeeper',  pid: 'uthappa-001' },
  { name: 'Tillakaratne Dilshan', team: 'India Tigers',    role: 'allrounder',    pid: 'dilshan-001' },
  { name: 'Ambati Rayudu',        team: 'India Tigers',    role: 'batsman',       pid: 'rayudu-001' },
  { name: 'Aaron Finch',          team: 'India Tigers',    role: 'batsman',       pid: 'finch-001' },
  { name: 'Pawan Negi',           team: 'India Tigers',    role: 'allrounder',    pid: 'negi-001' },
  { name: 'Samit Patel',          team: 'India Tigers',    role: 'allrounder',    pid: 'spatel-001' },
  { name: 'Shahbaz Nadeem',       team: 'India Tigers',    role: 'bowler',        pid: 'nadeem-001' },
  { name: 'Kuldeep Hooda',        team: 'India Tigers',    role: 'allrounder',    pid: 'khooda-001' },
  { name: 'Jeevan Mendis',        team: 'India Tigers',    role: 'allrounder',    pid: 'mendis-001' },
  { name: 'Milinda Siriwardana',  team: 'India Tigers',    role: 'allrounder',    pid: 'siri-001' },
  { name: 'Abu Nechim',           team: 'India Tigers',    role: 'bowler',        pid: 'nechim-001' },
  { name: 'Amitoze Singh',        team: 'India Tigers',    role: 'bowler',        pid: 'amitoze-001' },
  // Mumbai Spartans
  { name: 'Suresh Raina',         team: 'Mumbai Spartans', role: 'batsman',       pid: 'raina-001' },
  { name: 'Chadwick Walton',      team: 'Mumbai Spartans', role: 'batsman',       pid: 'walton-001' },
  { name: 'Bharath Chipli',       team: 'Mumbai Spartans', role: 'wicketkeeper',  pid: 'chipli-001' },
  { name: 'Carlos Brathwaite',    team: 'Mumbai Spartans', role: 'allrounder',    pid: 'brathwaite-001' },
  { name: 'Isuru Udana',          team: 'Mumbai Spartans', role: 'allrounder',    pid: 'udana-001' },
  { name: 'KC Cariappa',          team: 'Mumbai Spartans', role: 'bowler',        pid: 'cariappa-001' },
  { name: 'Asad Pathan',          team: 'Mumbai Spartans', role: 'bowler',        pid: 'apathan-001' },
  { name: 'S Sreesanth',          team: 'Mumbai Spartans', role: 'bowler',        pid: 'sreesanth-001' },
  { name: 'Manan Sharma',         team: 'Mumbai Spartans', role: 'batsman',       pid: 'msharma-001' },
  { name: 'Suboth Bhati',         team: 'Mumbai Spartans', role: 'bowler',        pid: 'bhati-001' },
  { name: 'Ishwar Chaudhary',     team: 'Mumbai Spartans', role: 'bowler',        pid: 'ishwar-001' },
  { name: 'Bipul Sharma',         team: 'Mumbai Spartans', role: 'allrounder',    pid: 'bsharma-001' },
  // Royal Riders Punjab
  { name: 'Cheteshwar Pujara',    team: 'Royal Riders Punjab', role: 'batsman',   pid: 'pujara-001' },
  { name: 'Asghar Afghan',        team: 'Royal Riders Punjab', role: 'allrounder',pid: 'afghan-001' },
  { name: 'Thisara Perera',       team: 'Royal Riders Punjab', role: 'allrounder',pid: 'tperera-001' },
  { name: 'Danushka Gunathilaka', team: 'Royal Riders Punjab', role: 'batsman',   pid: 'guna-001' },
  { name: 'Rishi Dhawan',         team: 'Royal Riders Punjab', role: 'allrounder',pid: 'rdhawan-001' },
  { name: 'Seekkuge Prasanna',    team: 'Royal Riders Punjab', role: 'bowler',    pid: 'prasanna-001' },
  { name: 'Anureet Singh',        team: 'Royal Riders Punjab', role: 'bowler',    pid: 'anureet-001' },
  { name: 'Pawan Suyal',          team: 'Royal Riders Punjab', role: 'bowler',    pid: 'suyal-001' },
  { name: 'Angelo Perera',        team: 'Royal Riders Punjab', role: 'allrounder',pid: 'aperera-001' },
  { name: 'Samiullah Shinwari',   team: 'Royal Riders Punjab', role: 'bowler',    pid: 'shinwari-001' },
  { name: 'Philip Mustard',       team: 'Royal Riders Punjab', role: 'wicketkeeper',pid:'mustard-001'},
  // India Captains
  { name: 'Irfan Pathan',         team: 'India Captains',  role: 'allrounder',    pid: 'ipathan-001' },
  { name: 'Hashim Amla',          team: 'India Captains',  role: 'batsman',       pid: 'amla-001' },
  { name: 'Sheldon Jackson',      team: 'India Captains',  role: 'wicketkeeper',  pid: 'sjackson-001' },
  { name: 'Asela Gunaratne',      team: 'India Captains',  role: 'allrounder',    pid: 'guna-ic-001' },
  { name: 'Parwinder Awana',      team: 'India Captains',  role: 'bowler',        pid: 'awana-001' },
  { name: 'Dinesh Karthik',       team: 'India Captains',  role: 'wicketkeeper',  pid: 'karthik-001' },
];

const playerIds = {};
for (const p of players) {
  try {
    const r = db.prepare('INSERT OR IGNORE INTO players (name, team, role, external_player_id) VALUES (?,?,?,?)').run(p.name, p.team, p.role, p.pid);
    const row = db.prepare('SELECT id FROM players WHERE external_player_id = ?').get(p.pid);
    playerIds[p.pid] = row.id;
  } catch (e) { console.error('Player error:', p.name, e.message); }
}
console.log(`  Created ${Object.keys(playerIds).length} players`);

// ── 4. Past matches (completed, with stats and prizes) ────────────────────────
console.log('\nCreating past matches...');

const pastMatches = [
  {
    externalId: 'llc2026-match1-seed',
    teamA: 'India Captains', teamB: 'Mumbai Spartans',
    startTime: '2026-03-11T14:00:00.000Z',
    result: 'India Captains won by 23 runs',
    // batting: IC scored 150, MS scored 127
    // Stat highlights: Sheldon Jackson 51(31), Asela Gunaratne 4-20
    stats: {
      'sjackson-001': { runs:51,balls:31,fours:4,sixes:3,dismissal:'caught',overs:0,wkts:0,runs_c:0,maidens:0,catches:1,stumpings:0,runouts:0 },
      'amla-001':     { runs:38,balls:29,fours:3,sixes:1,dismissal:'bowled',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'guna-ic-001':  { runs:18,balls:14,fours:1,sixes:1,dismissal:'notout',overs:3.4,wkts:4,runs_c:20,maidens:0,catches:0,stumpings:0,runouts:0 },
      'ipathan-001':  { runs:12,balls:10,fours:1,sixes:0,dismissal:'notout',overs:2,wkts:1,runs_c:14,maidens:0,catches:1,stumpings:0,runouts:0 },
      'chipli-001':   { runs:47,balls:30,fours:3,sixes:4,dismissal:'caught',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'raina-001':    { runs:22,balls:18,fours:2,sixes:1,dismissal:'lbw',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'brathwaite-001':{ runs:14,balls:9,fours:0,sixes:2,dismissal:'caught',overs:2,wkts:0,runs_c:26,maidens:0,catches:0,stumpings:0,runouts:0 },
      'sreesanth-001':{ runs:0,balls:3,fours:0,sixes:0,dismissal:'bowled',overs:2,wkts:0,runs_c:22,maidens:0,catches:0,stumpings:0,runouts:0 },
    }
  },
  {
    externalId: 'llc2026-match2-seed',
    teamA: 'India Tigers', teamB: 'Royal Riders Punjab',
    startTime: '2026-03-12T14:00:00.000Z',
    result: 'India Tigers won by 20 runs',
    stats: {
      'gayle-001':   { runs:68,balls:42,fours:5,sixes:5,dismissal:'caught',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'dilshan-001': { runs:44,balls:35,fours:4,sixes:1,dismissal:'runout',overs:2,wkts:1,runs_c:16,maidens:0,catches:1,stumpings:0,runouts:0 },
      'negi-001':    { runs:22,balls:16,fours:1,sixes:2,dismissal:'notout',overs:3,wkts:2,runs_c:18,maidens:1,catches:0,stumpings:0,runouts:0 },
      'nadeem-001':  { runs:0,balls:1,fours:0,sixes:0,dismissal:'notout',overs:4,wkts:1,runs_c:28,maidens:0,catches:0,stumpings:0,runouts:0 },
      'pujara-001':  { runs:52,balls:44,fours:4,sixes:1,dismissal:'caught',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'afghan-001':  { runs:28,balls:20,fours:2,sixes:2,dismissal:'bowled',overs:2,wkts:0,runs_c:24,maidens:0,catches:0,stumpings:0,runouts:0 },
      'tperera-001': { runs:18,balls:12,fours:1,sixes:1,dismissal:'caught',overs:3,wkts:1,runs_c:30,maidens:0,catches:0,stumpings:0,runouts:0 },
      'prasanna-001':{ runs:2,balls:4,fours:0,sixes:0,dismissal:'bowled',overs:4,wkts:2,runs_c:22,maidens:1,catches:0,stumpings:0,runouts:0 },
    }
  },
  {
    externalId: 'llc2026-match3-seed',
    teamA: 'India Captains', teamB: 'Royal Riders Punjab',
    startTime: '2026-03-13T14:00:00.000Z',
    result: 'Royal Riders Punjab won by 6 wickets',
    stats: {
      'sjackson-001': { runs:29,balls:22,fours:2,sixes:1,dismissal:'stumped',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'amla-001':     { runs:41,balls:38,fours:3,sixes:0,dismissal:'caught',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'ipathan-001':  { runs:8,balls:6,fours:1,sixes:0,dismissal:'bowled',overs:4,wkts:2,runs_c:32,maidens:0,catches:0,stumpings:0,runouts:0 },
      'awana-001':    { runs:0,balls:2,fours:0,sixes:0,dismissal:'bowled',overs:3,wkts:0,runs_c:28,maidens:0,catches:0,stumpings:0,runouts:0 },
      'pujara-001':   { runs:61,balls:48,fours:5,sixes:2,dismissal:'notout',overs:0,wkts:0,runs_c:0,maidens:0,catches:1,stumpings:0,runouts:0 },
      'guna-001':     { runs:45,balls:33,fours:4,sixes:2,dismissal:'caught',overs:0,wkts:0,runs_c:0,maidens:0,catches:0,stumpings:0,runouts:0 },
      'tperera-001':  { runs:20,balls:14,fours:1,sixes:1,dismissal:'notout',overs:4,wkts:2,runs_c:30,maidens:0,catches:0,stumpings:0,runouts:0 },
      'prasanna-001': { runs:5,balls:4,fours:0,sixes:0,dismissal:'notout',overs:4,wkts:3,runs_c:24,maidens:1,catches:0,stumpings:0,runouts:0 },
    }
  },
];

// User team selections per past match (indices into player pid arrays)
// Each user picks different combos so leaderboard looks realistic
const userTeamSelections = {
  'rahul@test.com': {
    0: { main: ['sjackson-001','amla-001','guna-ic-001','ipathan-001','chipli-001','raina-001','brathwaite-001','sreesanth-001','walton-001','udana-001','cariappa-001'], cap:'sjackson-001', vc:'amla-001', b:['awana-001','apathan-001'] },
    1: { main: ['gayle-001','dilshan-001','negi-001','nadeem-001','pujara-001','afghan-001','tperera-001','prasanna-001','uthappa-001','finch-001','mendis-001'], cap:'gayle-001', vc:'pujara-001', b:['rdhawan-001','suyal-001'] },
    2: { main: ['sjackson-001','amla-001','ipathan-001','awana-001','pujara-001','guna-001','tperera-001','prasanna-001','karthik-001','rdhawan-001','anureet-001'], cap:'pujara-001', vc:'amla-001', b:['guna-ic-001','shinwari-001'] },
  },
  'priya@test.com': {
    0: { main: ['sjackson-001','amla-001','guna-ic-001','ipathan-001','chipli-001','raina-001','walton-001','udana-001','cariappa-001','apathan-001','ishwar-001'], cap:'guna-ic-001', vc:'chipli-001', b:['brathwaite-001','sreesanth-001'] },
    1: { main: ['gayle-001','dilshan-001','negi-001','pujara-001','afghan-001','tperera-001','prasanna-001','uthappa-001','finch-001','mendis-001','spatel-001'], cap:'gayle-001', vc:'dilshan-001', b:['nadeem-001','khooda-001'] },
    2: { main: ['amla-001','ipathan-001','awana-001','pujara-001','guna-001','tperera-001','prasanna-001','karthik-001','rdhawan-001','anureet-001','mustard-001'], cap:'prasanna-001', vc:'pujara-001', b:['sjackson-001','afghan-001'] },
  },
  'karthik@test.com': {
    0: { main: ['sjackson-001','amla-001','ipathan-001','chipli-001','raina-001','brathwaite-001','walton-001','udana-001','cariappa-001','apathan-001','bhati-001'], cap:'chipli-001', vc:'sjackson-001', b:['guna-ic-001','sreesanth-001'] },
    1: { main: ['gayle-001','dilshan-001','pujara-001','afghan-001','tperera-001','prasanna-001','uthappa-001','finch-001','mendis-001','spatel-001','nadeem-001'], cap:'pujara-001', vc:'gayle-001', b:['negi-001','khooda-001'] },
    2: { main: ['sjackson-001','amla-001','ipathan-001','pujara-001','guna-001','tperera-001','prasanna-001','rdhawan-001','anureet-001','mustard-001','guna-ic-001'], cap:'pujara-001', vc:'prasanna-001', b:['afghan-001','tperera-001'] },
  },
  'sneha@test.com': {
    0: { main: ['sjackson-001','amla-001','guna-ic-001','chipli-001','raina-001','brathwaite-001','walton-001','udana-001','cariappa-001','bhati-001','msharma-001'], cap:'amla-001', vc:'chipli-001', b:['ipathan-001','awana-001'] },
    1: { main: ['gayle-001','dilshan-001','negi-001','nadeem-001','afghan-001','tperera-001','uthappa-001','finch-001','mendis-001','spatel-001','khooda-001'], cap:'dilshan-001', vc:'gayle-001', b:['pujara-001','prasanna-001'] },
    2: { main: ['amla-001','ipathan-001','pujara-001','guna-001','tperera-001','prasanna-001','karthik-001','rdhawan-001','anureet-001','mustard-001','sjackson-001'], cap:'amla-001', vc:'guna-001', b:['awana-001','shinwari-001'] },
  },
};

const { calculateFantasyPoints } = require('../src/engines/scoringEngine');
const { DEFAULT_SCORING_CONFIG } = require('../src/engines/scoringConfig');
const { distributePrizes }       = require('../src/engines/prizeEngine');

for (let mi = 0; mi < pastMatches.length; mi++) {
  const m = pastMatches[mi];
  process.stdout.write(`\n  Match ${mi+1}: ${m.teamA} vs ${m.teamB}...`);

  // Insert match
  let matchId;
  const existingM = db.prepare('SELECT id FROM matches WHERE external_match_id = ?').get(m.externalId);
  if (existingM) {
    matchId = existingM.id;
    process.stdout.write(' (already exists) ');
  } else {
    const r = db.prepare(`
      INSERT INTO matches (season_id, external_match_id, team_a, team_b, venue, match_type, status, start_time)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(seasonId, m.externalId, m.teamA, m.teamB, 'Indira Gandhi Stadium, Haldwani', 't20', 'completed', m.startTime);
    matchId = r.lastInsertRowid;
    db.prepare('INSERT INTO match_config (match_id, entry_units) VALUES (?,?)').run(matchId, 300);
  }

  // Insert all players into squad as playing XI
  const allPids = [...new Set(Object.keys(m.stats))];
  for (const pid of allPids) {
    const dbPid = playerIds[pid];
    if (!dbPid) continue;
    try {
      db.prepare('INSERT OR IGNORE INTO match_squads (match_id, player_id, is_playing_xi) VALUES (?,?,1)').run(matchId, dbPid);
    } catch {}
  }

  // Insert stats and compute fantasy points
  for (const [pid, s] of Object.entries(m.stats)) {
    const dbPid = playerIds[pid];
    if (!dbPid) continue;
    const { total: fp } = calculateFantasyPoints({
      isPlayingXi: true, runs: s.runs, ballsFaced: s.balls,
      fours: s.fours, sixes: s.sixes, dismissalType: s.dismissal,
      oversBowled: s.overs, wickets: s.wkts, runsConceded: s.runs_c,
      maidens: s.maidens, catches: s.catches, stumpings: s.stumpings, runOuts: s.runouts,
    }, 'normal', DEFAULT_SCORING_CONFIG);
    try {
      db.prepare(`
        INSERT OR REPLACE INTO player_match_stats
          (match_id,player_id,runs,balls_faced,fours,sixes,dismissal_type,overs_bowled,wickets,runs_conceded,maidens,catches,stumpings,run_outs,fantasy_points,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      `).run(matchId,dbPid,s.runs,s.balls,s.fours,s.sixes,s.dismissal,s.overs,s.wkts,s.runs_c,s.maidens,s.catches,s.stumpings,s.runouts,fp);
    } catch {}
  }

  // Create user teams and compute totals
  const teamTotals = [];
  for (const [email, selections] of Object.entries(userTeamSelections)) {
    const sel = selections[mi];
    if (!sel) continue;
    const userId = userIds[email];
    const capDbId = playerIds[sel.cap];
    const vcDbId  = playerIds[sel.vc];

    // Check existing
    let utId;
    const existingUt = db.prepare('SELECT id FROM user_teams WHERE user_id=? AND match_id=?').get(userId, matchId);
    if (existingUt) { utId = existingUt.id; }
    else {
      const r = db.prepare(`
        INSERT INTO user_teams (user_id,match_id,captain_id,vice_captain_id,resolved_captain_id,resolved_vice_captain_id,locked_at,swap_processed_at)
        VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))
      `).run(userId,matchId,capDbId,vcDbId,capDbId,vcDbId);
      utId = r.lastInsertRowid;

      for (const pid of sel.main) {
        const dbPid = playerIds[pid];
        if (dbPid) db.prepare('INSERT OR IGNORE INTO user_team_players (user_team_id,player_id,is_backup,backup_order) VALUES (?,?,0,NULL)').run(utId,dbPid);
      }
      sel.b.forEach((pid,i) => {
        const dbPid = playerIds[pid];
        if (dbPid) db.prepare('INSERT OR IGNORE INTO user_team_players (user_team_id,player_id,is_backup,backup_order) VALUES (?,?,1,?)').run(utId,dbPid,i+1);
      });
    }

    // Compute team total with C/VC multipliers
    let total = 0;
    for (const pid of sel.main) {
      const dbPid = playerIds[pid];
      if (!dbPid) continue;
      const stats = db.prepare('SELECT * FROM player_match_stats WHERE match_id=? AND player_id=?').get(matchId, dbPid);
      if (!stats) continue;
      const role = dbPid === capDbId ? 'captain' : dbPid === vcDbId ? 'vice_captain' : 'normal';
      const { total: pts } = calculateFantasyPoints({
        isPlayingXi:true, runs:stats.runs, ballsFaced:stats.balls_faced,
        fours:stats.fours, sixes:stats.sixes, dismissalType:stats.dismissal_type,
        oversBowled:stats.overs_bowled, wickets:stats.wickets, runsConceded:stats.runs_conceded,
        maidens:stats.maidens, catches:stats.catches, stumpings:stats.stumpings, runOuts:stats.run_outs,
      }, role, DEFAULT_SCORING_CONFIG);
      total += pts;
    }

    db.prepare('UPDATE user_teams SET total_fantasy_points=? WHERE id=?').run(total, utId);
    teamTotals.push({ userId: utId, fantasyPoints: total, userEmail: email });
  }

  // Distribute prizes
  const sorted = [...teamTotals].sort((a,b) => b.fantasyPoints - a.fantasyPoints);
  const { totalPool, distributionRule, prizes } = distributePrizes(sorted, 300);

  // Write prize pool
  let poolId;
  const existingPool = db.prepare('SELECT id FROM match_prize_pools WHERE match_id=?').get(matchId);
  if (existingPool) { poolId = existingPool.id; }
  else {
    const r = db.prepare(`
      INSERT INTO match_prize_pools (match_id,participants_count,total_units,winners_count,distribution_rule,is_finalized,finalized_at)
      VALUES (?,?,?,?,?,1,datetime('now'))
    `).run(matchId,sorted.length,totalPool,prizes.filter(p=>p.grossUnits>0).length,distributionRule);
    poolId = r.lastInsertRowid;
  }

  // Write prize distributions and update ranks
  for (const prize of prizes) {
    try {
      db.prepare('INSERT OR IGNORE INTO prize_distributions (match_prize_pool_id,user_team_id,rank,gross_units,net_units,fantasy_points) VALUES (?,?,?,?,?,?)').run(poolId,prize.userId,prize.rank,prize.grossUnits,prize.netUnits,prize.fantasyPoints);
    } catch {}
    db.prepare('UPDATE user_teams SET match_rank=?,units_won=?,finalized_at=datetime(\'now\') WHERE id=?').run(prize.rank,prize.grossUnits,prize.userId);
  }

  // Update season leaderboard
  for (const prize of prizes) {
    const ut = db.prepare('SELECT user_id FROM user_teams WHERE id=?').get(prize.userId);
    if (!ut) continue;
    const isTop = prize.grossUnits > 0 ? 1 : 0;
    db.prepare(`
      INSERT INTO season_leaderboard (season_id,user_id,total_fantasy_points,total_units_won,net_units,matches_played,top_finishes,updated_at)
      VALUES (?,?,?,?,?,1,?,datetime('now'))
      ON CONFLICT(season_id,user_id) DO UPDATE SET
        total_fantasy_points=total_fantasy_points+excluded.total_fantasy_points,
        total_units_won=total_units_won+excluded.total_units_won,
        net_units=net_units+excluded.net_units,
        matches_played=matches_played+1,
        top_finishes=top_finishes+excluded.top_finishes,
        updated_at=datetime('now')
    `).run(seasonId,ut.user_id,prize.fantasyPoints,prize.grossUnits,prize.netUnits,isTop);
  }

  process.stdout.write(` done (pool: ${totalPool}, rule: ${distributionRule})`);
}

// ── 5. Today's upcoming match ──────────────────────────────────────────────────
console.log('\n\nCreating today\'s match...');

const todayMatch = {
  externalId: '106f2025-7660-4a5f-aa6e-8ab8a3a62124',
  teamA: 'Mumbai Spartans', teamB: 'India Tigers',
  startTime: '2026-03-14T14:00:00.000Z', // 7:30 PM IST
  venue: 'Indira Gandhi International Cricket Stadium, Haldwani',
};

const existingToday = db.prepare('SELECT id FROM matches WHERE external_match_id=?').get(todayMatch.externalId);
if (!existingToday) {
  const r = db.prepare(`
    INSERT INTO matches (season_id,external_match_id,team_a,team_b,venue,match_type,status,start_time)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(seasonId,todayMatch.externalId,todayMatch.teamA,todayMatch.teamB,todayMatch.venue,'t20','upcoming',todayMatch.startTime);
  db.prepare('INSERT INTO match_config (match_id,entry_units) VALUES (?,?)').run(r.lastInsertRowid, 300);
  console.log('  Created upcoming match id:', r.lastInsertRowid);
} else {
  console.log('  Today\'s match already exists, id:', existingToday.id);
}

// ── 6. Summary ────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════');
console.log('SEED COMPLETE');
console.log('════════════════════════════════════════');
console.log('\nSeason:     LLC 2026 Test League');
console.log('Invite Code: LLC2026');
console.log('\nUser accounts (all password: password123):');
users.forEach(u => console.log(`  ${u.email}  ${u.isAdmin ? '(ADMIN)' : ''}`));
console.log('\nMatches:');
console.log('  3 completed past matches with scores and prizes');
console.log('  1 upcoming: Mumbai Spartans vs India Tigers (today)');
console.log('\nSeason leaderboard:');
const lb = db.prepare(`
  SELECT u.name, sl.net_units, sl.matches_played, sl.top_finishes
  FROM season_leaderboard sl JOIN users u ON u.id=sl.user_id
  WHERE sl.season_id=? ORDER BY sl.net_units DESC
`).all(seasonId);
lb.forEach((r,i) => console.log(`  #${i+1} ${r.name.padEnd(12)} net:${String(r.net_units).padStart(5)}  played:${r.matches_played}  top:${r.top_finishes}`));
console.log('\nReady to test. Open the app and sign in!');
