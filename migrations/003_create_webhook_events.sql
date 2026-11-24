-- Inbox durável de webhooks ("persistir primeiro, processar depois").
--  * uq_webhook_source_event  => idempotência: o mesmo (source, event_id) só entra uma vez.
--  * status/attempts/next_attempt_at/locked_until => máquina de estados com retry, backoff e recuperação de worker morto.
--  * O Redis é só o "acelerador" de entrega; a fonte da verdade do estado é esta tabela.
CREATE TABLE webhook_events (
  id                CHAR(36)     NOT NULL,
  source            VARCHAR(60)  NOT NULL,
  external_event_id VARCHAR(100) NOT NULL,
  payload           JSON         NOT NULL,
  payload_hash      CHAR(64)     NOT NULL,
  status            ENUM('pending', 'processing', 'processed', 'duplicate', 'dead') NOT NULL DEFAULT 'pending',
  attempts          INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  enqueued_at       DATETIME(6)  NULL,
  locked_until      DATETIME(6)  NULL,
  last_error        VARCHAR(100) NULL,
  lead_id           CHAR(36)     NULL,
  received_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at      DATETIME(6)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_source_event (source, external_event_id),
  KEY idx_webhook_due (status, next_attempt_at),
  KEY idx_webhook_locked (status, locked_until),
  KEY idx_webhook_received (received_at),
  CONSTRAINT fk_webhook_lead FOREIGN KEY (lead_id) REFERENCES leads (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
