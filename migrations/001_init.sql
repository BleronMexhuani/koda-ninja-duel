CREATE TABLE players (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    ryo           INTEGER     NOT NULL DEFAULT 0 CHECK (ryo >= 0),
    xp            INTEGER     NOT NULL DEFAULT 0 CHECK (xp >= 0),
    wins          INTEGER     NOT NULL DEFAULT 0,
    losses        INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_username_lower ON players (lower(username));

CREATE TABLE sessions (
    token_hash BYTEA       PRIMARY KEY,
    player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_player ON sessions (player_id);

-- Techniques a player owns. slot (0-5) is set when it is equipped.
CREATE TABLE player_techniques (
    player_id    BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    technique_id TEXT        NOT NULL,
    rank         SMALLINT    NOT NULL DEFAULT 1 CHECK (rank BETWEEN 1 AND 3),
    slot         SMALLINT    CHECK (slot BETWEEN 0 AND 5),
    acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, technique_id)
);
CREATE UNIQUE INDEX player_techniques_slot ON player_techniques (player_id, slot) WHERE slot IS NOT NULL;

CREATE TABLE mission_progress (
    player_id        BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    mission_id       TEXT        NOT NULL,
    clears           INTEGER     NOT NULL DEFAULT 0,
    best_turns       INTEGER,
    first_cleared_at TIMESTAMPTZ,
    PRIMARY KEY (player_id, mission_id)
);

CREATE TABLE battles (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    mission_id TEXT        NOT NULL,
    status     TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'forfeit')),
    state      JSONB       NOT NULL,
    turns      INTEGER     NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX battles_one_active ON battles (player_id) WHERE status = 'active';

-- Every change to a player's ryo, for auditing.
CREATE TABLE ledger (
    id         BIGSERIAL PRIMARY KEY,
    player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    amount     INTEGER     NOT NULL,
    reason     TEXT        NOT NULL,
    ref        TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_player ON ledger (player_id, created_at DESC);
