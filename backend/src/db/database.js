'use strict';

/**
 * DATABASE SCHEMA
 * Run once on startup via initDb().
 * Uses better-sqlite3 (synchronous SQLite driver).
 * All foreign keys enforced via PRAGMA foreign_keys = ON.
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/fantasy.db');

let db;

function getDb() {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  runMigrations(db);
  return db;
}

function createTables(db) {
  db.exec(`

    -- ── USERS ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── SEASONS ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS seasons (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      year          INTEGER NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'upcoming'
                            CHECK (status IN ('upcoming','active','completed')),
      invite_code   TEXT    NOT NULL UNIQUE,
      admin_user_id INTEGER NOT NULL REFERENCES users(id),
      max_players   INTEGER NOT NULL DEFAULT 20,
      series_ids    TEXT    DEFAULT '[]',  -- JSON array of CricAPI series IDs for auto-schedule
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── SEASON MEMBERSHIPS ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS season_memberships (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id  INTEGER NOT NULL REFERENCES seasons(id),
      user_id    INTEGER NOT NULL REFERENCES users(id),
      joined_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (season_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memberships_season ON season_memberships(season_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_user   ON season_memberships(user_id);

    -- ── MATCHES ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS matches (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id         INTEGER NOT NULL REFERENCES seasons(id),
      external_match_id TEXT    NOT NULL UNIQUE,
      team_a            TEXT    NOT NULL,
      team_b            TEXT    NOT NULL,
      venue             TEXT,
      match_type        TEXT    NOT NULL DEFAULT 't20'
                                CHECK (match_type IN ('t20','odi','test')),
      status            TEXT    NOT NULL DEFAULT 'upcoming'
                                CHECK (status IN ('upcoming','live','completed','abandoned')),
      start_time        TEXT    NOT NULL,
      last_synced       TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season_id);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

    -- ── MATCH CONFIG (per-match entry units override) ──────────────────────
    CREATE TABLE IF NOT EXISTS match_config (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id     INTEGER NOT NULL UNIQUE REFERENCES matches(id),
      entry_units  INTEGER NOT NULL DEFAULT 300
    );

    -- ── PLAYERS ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS players (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      team               TEXT NOT NULL,
      role               TEXT CHECK (role IN ('batsman','bowler','allrounder','wicketkeeper',NULL)),
      external_player_id TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_players_external ON players(external_player_id);

    -- ── MATCH SQUADS ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS match_squads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id        INTEGER NOT NULL REFERENCES matches(id),
      player_id       INTEGER NOT NULL REFERENCES players(id),
      is_playing_xi   INTEGER NOT NULL DEFAULT 0,
      UNIQUE (match_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_squads_match  ON match_squads(match_id);
    CREATE INDEX IF NOT EXISTS idx_squads_player ON match_squads(player_id);

    -- ── PLAYER MATCH STATS ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS player_match_stats (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id         INTEGER NOT NULL REFERENCES matches(id),
      player_id        INTEGER NOT NULL REFERENCES players(id),
      -- batting
      runs             INTEGER NOT NULL DEFAULT 0,
      balls_faced      INTEGER NOT NULL DEFAULT 0,
      fours            INTEGER NOT NULL DEFAULT 0,
      sixes            INTEGER NOT NULL DEFAULT 0,
      dismissal_type   TEXT,   -- 'bowled'|'lbw'|'caught'|'runout'|'stumped'|'notout'|'dnb'
      -- bowling
      overs_bowled     REAL    NOT NULL DEFAULT 0,
      wickets          INTEGER NOT NULL DEFAULT 0,
      runs_conceded    INTEGER NOT NULL DEFAULT 0,
      maidens          INTEGER NOT NULL DEFAULT 0,
      -- fielding
      catches          INTEGER NOT NULL DEFAULT 0,
      stumpings        INTEGER NOT NULL DEFAULT 0,
      run_outs         INTEGER NOT NULL DEFAULT 0,
      -- computed
      fantasy_points   INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (match_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stats_match  ON player_match_stats(match_id);
    CREATE INDEX IF NOT EXISTS idx_stats_player ON player_match_stats(player_id);

    -- ── USER TEAMS ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_teams (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id),
      match_id            INTEGER NOT NULL REFERENCES matches(id),
      captain_id          INTEGER NOT NULL REFERENCES players(id),
      vice_captain_id     INTEGER NOT NULL REFERENCES players(id),
      -- post-swap resolved values (set by swap job at match start)
      resolved_captain_id     INTEGER REFERENCES players(id),
      resolved_vice_captain_id INTEGER REFERENCES players(id),
      -- scoring
      total_fantasy_points INTEGER NOT NULL DEFAULT 0,
      match_rank          INTEGER,
      units_won           INTEGER NOT NULL DEFAULT 0,
      -- timestamps
      locked_at           TEXT,   -- set when match starts (team lock)
      swap_processed_at   TEXT,   -- set when auto-swap job runs
      finalized_at        TEXT,   -- set when match is finalized
      created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, match_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_teams_match ON user_teams(match_id);
    CREATE INDEX IF NOT EXISTS idx_user_teams_user  ON user_teams(user_id);

    -- ── USER TEAM PLAYERS ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_team_players (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_team_id  INTEGER NOT NULL REFERENCES user_teams(id),
      player_id     INTEGER NOT NULL REFERENCES players(id),
      is_backup     INTEGER NOT NULL DEFAULT 0,
      backup_order  INTEGER,  -- 1 or 2 for backups, NULL for main players
      UNIQUE (user_team_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_utp_team ON user_team_players(user_team_id);

    -- ── USER TEAM SWAPS (audit log) ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_team_swaps (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_team_id         INTEGER NOT NULL REFERENCES user_teams(id),
      swapped_out_player_id INTEGER NOT NULL REFERENCES players(id),
      swapped_in_player_id  INTEGER NOT NULL REFERENCES players(id),
      inherited_role       TEXT CHECK (inherited_role IN ('captain','vice_captain',NULL)),
      triggered_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_swaps_team ON user_team_swaps(user_team_id);

    -- ── MATCH PRIZE POOL ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS match_prize_pools (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id            INTEGER NOT NULL UNIQUE REFERENCES matches(id),
      participants_count  INTEGER NOT NULL DEFAULT 0,
      total_units         INTEGER NOT NULL DEFAULT 0,
      winners_count       INTEGER NOT NULL DEFAULT 0,
      distribution_rule   TEXT,   -- '2-winner'|'3-winner'|'no-prize'
      is_finalized        INTEGER NOT NULL DEFAULT 0,
      finalized_at        TEXT
    );

    -- ── PRIZE DISTRIBUTIONS (full audit trail) ─────────────────────────────
    CREATE TABLE IF NOT EXISTS prize_distributions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      match_prize_pool_id  INTEGER NOT NULL REFERENCES match_prize_pools(id),
      user_team_id         INTEGER NOT NULL REFERENCES user_teams(id),
      rank                 INTEGER NOT NULL,
      gross_units          INTEGER NOT NULL DEFAULT 0,
      net_units            INTEGER NOT NULL DEFAULT 0,
      fantasy_points       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_prize_dist_pool ON prize_distributions(match_prize_pool_id);
    CREATE INDEX IF NOT EXISTS idx_prize_dist_team ON prize_distributions(user_team_id);

    -- ── SEASON LEADERBOARD ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS season_leaderboard (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id            INTEGER NOT NULL REFERENCES seasons(id),
      user_id              INTEGER NOT NULL REFERENCES users(id),
      total_fantasy_points INTEGER NOT NULL DEFAULT 0,
      total_units_won      INTEGER NOT NULL DEFAULT 0,
      net_units            INTEGER NOT NULL DEFAULT 0,
      matches_played       INTEGER NOT NULL DEFAULT 0,
      top_finishes         INTEGER NOT NULL DEFAULT 0,  -- prize-winning finishes
      season_rank          INTEGER,
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (season_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_leaderboard_season ON season_leaderboard(season_id);

    -- ── SCORING CONFIG (future: per-season point overrides) ────────────────
    CREATE TABLE IF NOT EXISTS scoring_config (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id   INTEGER REFERENCES seasons(id),  -- NULL = global default
      config_json TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── PUSH SUBSCRIPTIONS ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      endpoint     TEXT    NOT NULL UNIQUE,
      p256dh_key   TEXT    NOT NULL,
      auth_key     TEXT    NOT NULL,
      user_agent   TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { initDb, getDb, closeDb, runMigrations };

// Run after createTables — safe migrations for schema additions
function runMigrations(db) {
  // Add series_ids to seasons if missing (for existing DBs)
  try {
    db.prepare("SELECT series_ids FROM seasons LIMIT 1").get();
  } catch {
    db.prepare("ALTER TABLE seasons ADD COLUMN series_ids TEXT DEFAULT '[]'").run();
    console.log('[db] Migration: added series_ids to seasons');
  }
}
