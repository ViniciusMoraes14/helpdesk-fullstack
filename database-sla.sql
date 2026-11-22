-- Help Desk Online: migração aditiva do módulo SLA
-- Execute no banco PostgreSQL usado pelo projeto. O server.js também executa
-- estas criações automaticamente ao iniciar, de forma idempotente.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_first_response_target INTEGER,
  ADD COLUMN IF NOT EXISTS sla_resolution_target INTEGER;

CREATE TABLE IF NOT EXISTS sla_policies (
  priority VARCHAR(20) PRIMARY KEY,
  first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes > 0),
  resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sla_holidays (
  holiday_date DATE PRIMARY KEY,
  description VARCHAR(160) NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_sla_pauses (
  id BIGSERIAL PRIMARY KEY,
  ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  pause_type VARCHAR(20) NOT NULL CHECK (pause_type IN ('requester','resolved')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ticket_sla_pauses_ticket
  ON ticket_sla_pauses(ticket_id, started_at);

CREATE TABLE IF NOT EXISTS ticket_sla_history (
  id BIGSERIAL PRIMARY KEY,
  ticket_id VARCHAR(20) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  description VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sla_policies(priority, first_response_minutes, resolution_minutes) VALUES
  ('Crítica', 15, 240),
  ('Alta', 30, 480),
  ('Média', 120, 1440),
  ('Baixa', 240, 2880)
ON CONFLICT(priority) DO NOTHING;

UPDATE tickets t SET
  sla_first_response_target = COALESCE(t.sla_first_response_target, p.first_response_minutes),
  sla_resolution_target = COALESCE(t.sla_resolution_target, p.resolution_minutes)
FROM sla_policies p
WHERE t.priority = p.priority
  AND (t.sla_first_response_target IS NULL OR t.sla_resolution_target IS NULL);

-- Backfill conservador para chamados anteriores à implantação do SLA.
UPDATE tickets SET first_response_at = updated_at
WHERE first_response_at IS NULL
  AND (status = 'Em atendimento' OR status IN ('Resolvido','Fechado','Concluído','Concluido'));

UPDATE tickets SET resolved_at = updated_at
WHERE resolved_at IS NULL
  AND status IN ('Resolvido','Fechado','Concluído','Concluido');

INSERT INTO ticket_sla_pauses(ticket_id,pause_type,started_at)
SELECT t.id,'requester',t.updated_at
FROM tickets t
WHERE t.status = 'Aguardando solicitante'
  AND NOT EXISTS (
    SELECT 1 FROM ticket_sla_pauses p
    WHERE p.ticket_id=t.id AND p.pause_type='requester' AND p.ended_at IS NULL
  );

INSERT INTO ticket_sla_pauses(ticket_id,pause_type,started_at)
SELECT t.id,'resolved',COALESCE(t.resolved_at,t.updated_at)
FROM tickets t
WHERE t.status IN ('Resolvido','Fechado','Concluído','Concluido')
  AND NOT EXISTS (
    SELECT 1 FROM ticket_sla_pauses p
    WHERE p.ticket_id=t.id AND p.pause_type='resolved' AND p.ended_at IS NULL
  );
