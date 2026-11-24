-- Vendedores. `last_assigned_at` é o "ponteiro" do round-robin (NULL = nunca recebeu lead = primeiro da fila).
CREATE TABLE sellers (
  id               CHAR(36)      NOT NULL,
  name             VARCHAR(120)  NOT NULL,
  email            VARCHAR(254)  NOT NULL,
  active           TINYINT(1)    NOT NULL DEFAULT 1,
  last_assigned_at DATETIME(6)   NULL,
  created_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at       DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sellers_email (email),
  -- Cobre exatamente a consulta do round-robin: WHERE active = 1 ORDER BY last_assigned_at, id
  KEY idx_sellers_rr (active, last_assigned_at, id),
  CONSTRAINT chk_sellers_active CHECK (active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
