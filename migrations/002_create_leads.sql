-- Leads. Unicidade de negócio = telefone normalizado em E.164 (uq_leads_phone): é a barreira REAL contra
-- duplicidade concorrente (a aplicação não faz "SELECT e depois INSERT").
-- `seq` é um id sequencial INTERNO usado apenas para paginação por cursor; nunca é exposto pela API.
CREATE TABLE leads (
  id          CHAR(36)        NOT NULL,
  seq         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120)    NOT NULL,
  email       VARCHAR(254)    NULL,
  phone_e164  VARCHAR(20)     NOT NULL,
  phone_raw   VARCHAR(32)     NOT NULL,
  channel     ENUM('api', 'webhook')            NOT NULL,
  origin      VARCHAR(60)     NULL,
  notes       VARCHAR(1000)   NULL,
  status      ENUM('unassigned', 'assigned')    NOT NULL DEFAULT 'unassigned',
  seller_id   CHAR(36)        NULL,
  assigned_at DATETIME(6)     NULL,
  created_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_leads_seq (seq),
  UNIQUE KEY uq_leads_phone (phone_e164),
  KEY idx_leads_status_seq (status, seq),
  KEY idx_leads_seller_seq (seller_id, seq),
  KEY idx_leads_channel_seq (channel, seq),
  KEY idx_leads_origin_seq (origin, seq),
  KEY idx_leads_email (email),
  KEY idx_leads_name (name),
  KEY idx_leads_created_at (created_at),
  CONSTRAINT fk_leads_seller FOREIGN KEY (seller_id) REFERENCES sellers (id),
  -- Invariante de atribuição garantida pelo banco: ou o lead está livre, ou tem vendedor E data de atribuição.
  CONSTRAINT chk_leads_assignment CHECK (
    (status = 'unassigned' AND seller_id IS NULL AND assigned_at IS NULL) OR
    (status = 'assigned' AND seller_id IS NOT NULL AND assigned_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
