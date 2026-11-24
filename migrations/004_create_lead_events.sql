-- Trilha de rastreabilidade (append-only): criação, atribuição e tentativas duplicadas de cada lead.
-- `request_id` correlaciona o evento com o log da requisição HTTP; `webhook_event_id` com o webhook de origem.
CREATE TABLE lead_events (
  seq              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id          CHAR(36)        NOT NULL,
  type             ENUM('lead.created', 'lead.assigned', 'lead.duplicate_attempt') NOT NULL,
  channel          ENUM('api', 'webhook', 'system') NOT NULL,
  seller_id        CHAR(36)        NULL,
  webhook_event_id CHAR(36)        NULL,
  request_id       VARCHAR(64)     NULL,
  metadata         JSON            NULL,
  created_at       DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (seq),
  KEY idx_lead_events_lead (lead_id, seq),
  KEY idx_lead_events_seller (seller_id),
  KEY idx_lead_events_webhook (webhook_event_id),
  CONSTRAINT fk_lead_events_lead FOREIGN KEY (lead_id) REFERENCES leads (id),
  CONSTRAINT fk_lead_events_seller FOREIGN KEY (seller_id) REFERENCES sellers (id),
  CONSTRAINT fk_lead_events_webhook FOREIGN KEY (webhook_event_id) REFERENCES webhook_events (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
