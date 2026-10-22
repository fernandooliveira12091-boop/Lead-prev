-- 0001_esquema_inicial.up.sql
-- Esquema inicial do Gerador de Leads Previdenciários (PostgreSQL 16+).
-- Reversão: 0001_esquema_inicial.down.sql
--
-- Princípios:
--  * Telefone nunca é chave primária; a identidade de um lead vem de (canal, id_externo).
--  * A origem inicial é imutável: lead_origens é só de inserção; correções entram como nova linha.
--  * Auditoria e histórico de status são só de inserção.
--  * Nada de CPF, documentos, laudos ou extratos nesta fase.

BEGIN;

CREATE SCHEMA IF NOT EXISTS leadprev;
SET search_path TO leadprev;

-- ---------------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------------

CREATE FUNCTION tg_atualizado_em() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

CREATE FUNCTION tg_somente_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é somente de inserção (operação % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;

-- ---------------------------------------------------------------------------
-- publicacoes
-- ---------------------------------------------------------------------------

CREATE TABLE publicacoes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z]{2,5}[0-9]{3}$'),  -- ex.: AR001, SMR002
  plataforma     text NOT NULL CHECK (plataforma IN ('instagram', 'facebook', 'whatsapp', 'outro')),
  id_externo     text,                                   -- media id do Instagram, quando conhecido
  tema           text NOT NULL,
  beneficio      text NOT NULL CHECK (beneficio IN ('aposentadoria_rural', 'salario_maternidade_rural', 'outro')),
  url            text CHECK (url IS NULL OR url ~ '^https://'),
  publicada_em   timestamptz,
  status         text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'publicada', 'arquivada')),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX publicacoes_externo_uk ON publicacoes (plataforma, id_externo) WHERE id_externo IS NOT NULL;
CREATE TRIGGER publicacoes_atualizado_em BEFORE UPDATE ON publicacoes
  FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();

-- ---------------------------------------------------------------------------
-- leads e identidades
-- ---------------------------------------------------------------------------

CREATE TABLE leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                 text CHECK (length(nome) <= 120),
  telefone_e164        text CHECK (telefone_e164 ~ '^\+[1-9][0-9]{7,14}$'),  -- não é chave, não é único
  canal_entrada        text NOT NULL CHECK (canal_entrada IN ('whatsapp', 'instagram_direct', 'instagram_comentario', 'manual')),
  status               text NOT NULL DEFAULT 'novo_contato' CHECK (status IN (
                         'novo_contato', 'triagem_em_andamento', 'aguardando_informacoes',
                         'pendente_analise_juridica', 'analise_realizada', 'aguardando_retorno',
                         'contratado', 'nao_prosseguiu', 'encerrado')),
  responsavel          text,                              -- usuário interno (não é dado do lead)
  automacao_pausada    boolean NOT NULL DEFAULT false,    -- true = a IA/automação não responde
  motivo_pausa         text CHECK (motivo_pausa IN ('pedido_humano', 'pedido_interrupcao', 'handoff', 'manual', 'erro')),
  motivo_nao_prosseguimento text,
  primeiro_contato_em  timestamptz NOT NULL,
  ultima_interacao_em  timestamptz,
  anonimizado_em       timestamptz,                       -- retenção: dados pessoais apagados, métricas preservadas
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CHECK (automacao_pausada = (motivo_pausa IS NOT NULL))
);
CREATE INDEX leads_status_idx ON leads (status);
CREATE INDEX leads_ultima_interacao_idx ON leads (ultima_interacao_em);
CREATE TRIGGER leads_atualizado_em BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();

-- Identificadores dos canais (wa_id do WhatsApp, IGSID do Instagram).
-- Política de deduplicação: o mesmo (canal, id_externo) é sempre o mesmo lead.
-- Identidades de canais diferentes NUNCA são unidas automaticamente (nem por nome ou telefone);
-- a união é manual e auditada.
CREATE TABLE lead_identidades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  canal       text NOT NULL CHECK (canal IN ('whatsapp', 'instagram')),
  id_externo  text NOT NULL CHECK (length(id_externo) BETWEEN 1 AND 64),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal, id_externo)
);
CREATE INDEX lead_identidades_lead_idx ON lead_identidades (lead_id);

-- Histórico de status (base para tempo até revisão humana e conversão entre etapas).
CREATE TABLE lead_status_historico (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id       uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  status_de     text,
  status_para   text NOT NULL,
  alterado_em   timestamptz NOT NULL DEFAULT now(),
  alterado_por  text NOT NULL DEFAULT current_setting('leadprev.ator', true)
);
CREATE INDEX lead_status_historico_lead_idx ON lead_status_historico (lead_id, alterado_em);

CREATE FUNCTION tg_lead_status_historico() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO lead_status_historico (lead_id, status_de, status_para, alterado_por)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            coalesce(nullif(current_setting('leadprev.ator', true), ''), 'desconhecido'));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER leads_status_historico AFTER INSERT OR UPDATE OF status ON leads
  FOR EACH ROW EXECUTE FUNCTION tg_lead_status_historico();

-- ---------------------------------------------------------------------------
-- interacoes (mensagens e eventos recebidos/enviados)
-- ---------------------------------------------------------------------------

CREATE TABLE interacoes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               uuid REFERENCES leads (id) ON DELETE CASCADE,  -- nulo até o lead ser resolvido
  canal                 text NOT NULL CHECK (canal IN ('whatsapp', 'instagram')),
  direcao               text NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  tipo                  text NOT NULL CHECK (tipo IN (
                          'texto', 'midia', 'comentario', 'referral', 'template',
                          'resposta_privada', 'botao', 'sistema')),
  id_externo            text,                                -- wamid, mid, comment id...
  ocorrido_em           timestamptz NOT NULL,
  recebido_em           timestamptz NOT NULL DEFAULT now(),
  status_processamento  text NOT NULL DEFAULT 'recebida' CHECK (status_processamento IN (
                          'recebida', 'processando', 'processada', 'ignorada',
                          'falha_temporaria', 'falha_permanente')),
  tentativas            smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_tentativa_em  timestamptz,
  ultimo_erro           text CHECK (length(ultimo_erro) <= 500),   -- código/mensagem sanitizada, sem dados pessoais
  -- Conteúdo só enquanto necessário para a triagem (ver decisão D7); apagado por expurgar_conteudo_expirado().
  conteudo_texto        text CHECK (length(conteudo_texto) <= 4096),
  conteudo_expira_em    timestamptz,
  workflow              text,                                -- ex.: 'WF03_WhatsApp_Inbound'
  execucao_ref          text,                                -- id da execução no n8n
  CHECK (conteudo_texto IS NULL OR conteudo_expira_em IS NOT NULL)
);
-- Idempotência: o mesmo evento da Meta nunca é registrado duas vezes.
CREATE UNIQUE INDEX interacoes_externo_uk ON interacoes (canal, direcao, id_externo) WHERE id_externo IS NOT NULL;
CREATE INDEX interacoes_lead_idx ON interacoes (lead_id, ocorrido_em);
CREATE INDEX interacoes_retentativa_idx ON interacoes (proxima_tentativa_em)
  WHERE status_processamento = 'falha_temporaria';

-- ---------------------------------------------------------------------------
-- lead_origens (atribuição por publicação)
-- ---------------------------------------------------------------------------

CREATE TABLE lead_origens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  publicacao_id     uuid REFERENCES publicacoes (id),
  canal             text NOT NULL CHECK (canal IN ('whatsapp', 'instagram_direct', 'instagram_comentario', 'manual')),
  metodo            text NOT NULL CHECK (metodo IN ('direct', 'link_code', 'ad_metadata', 'manual', 'unknown')),
  confianca         text NOT NULL CHECK (confianca IN ('alta', 'media', 'baixa', 'nenhuma')),
  codigo_informado  text CHECK (length(codigo_informado) <= 64),   -- código como chegou, mesmo se não reconhecido
  campanha          text CHECK (length(campanha) <= 128),          -- id do anúncio/campanha, se houver
  metadados         jsonb CHECK (metadados IS NULL OR pg_column_size(metadados) <= 2048),
  eh_primeira       boolean NOT NULL,
  corrige_origem_id uuid REFERENCES lead_origens (id),             -- correção manual aponta para a origem corrigida
  interacao_id      uuid REFERENCES interacoes (id),
  registrado_em     timestamptz NOT NULL DEFAULT now(),
  registrado_por    text NOT NULL,
  CHECK (metodo <> 'unknown' OR (publicacao_id IS NULL AND confianca = 'nenhuma')),
  CHECK (publicacao_id IS NOT NULL OR confianca IN ('baixa', 'nenhuma')),
  CHECK (corrige_origem_id IS NULL OR metodo = 'manual')
);
CREATE UNIQUE INDEX lead_origens_primeira_uk ON lead_origens (lead_id) WHERE eh_primeira;
CREATE INDEX lead_origens_publicacao_idx ON lead_origens (publicacao_id);
CREATE INDEX lead_origens_lead_idx ON lead_origens (lead_id, registrado_em);
CREATE TRIGGER lead_origens_imutavel BEFORE UPDATE OR DELETE ON lead_origens
  FOR EACH ROW EXECUTE FUNCTION tg_somente_insercao();

-- ---------------------------------------------------------------------------
-- triagens
-- ---------------------------------------------------------------------------

CREATE TABLE triagens (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  beneficio_interesse    text NOT NULL DEFAULT 'indefinido' CHECK (beneficio_interesse IN (
                           'aposentadoria_rural', 'salario_maternidade_rural', 'indefinido')),
  status                 text NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento', 'concluida', 'cancelada')),
  etapa_atual            text,                         -- id da pergunta corrente no fluxo
  respostas              jsonb NOT NULL DEFAULT '{}'::jsonb,   -- validado por JSON Schema antes de gravar
  informacoes_pendentes  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(informacoes_pendentes) = 'array'),
  contradicoes           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contradicoes) = 'array'),
  resumo                 text CHECK (length(resumo) <= 4000),
  revisao_humana         boolean NOT NULL DEFAULT false,
  motivo_encaminhamento  text,
  proxima_acao_sugerida  text,
  versao_fluxo           text NOT NULL,
  versao_prompt          text,
  modelo_ia              text,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX triagens_ativa_uk ON triagens (lead_id) WHERE status = 'em_andamento';
CREATE INDEX triagens_revisao_idx ON triagens (revisao_humana) WHERE revisao_humana;
CREATE TRIGGER triagens_atualizado_em BEFORE UPDATE ON triagens
  FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();

-- ---------------------------------------------------------------------------
-- preferencias_contato (consentimentos, bases legais e revogações)
-- Cada linha é um evento; o estado vigente é a linha mais recente por (lead, finalidade).
-- ---------------------------------------------------------------------------

CREATE TABLE preferencias_contato (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  finalidade       text NOT NULL CHECK (finalidade IN (
                     'triagem_inicial', 'contato_whatsapp', 'contato_instagram', 'mensagens_acompanhamento')),
  estado           text NOT NULL CHECK (estado IN ('concedido', 'negado', 'revogado')),
  base_legal       text NOT NULL CHECK (base_legal IN (
                     'consentimento', 'procedimentos_preliminares_contrato', 'exercicio_regular_direitos',
                     'legitimo_interesse', 'a_definir')),
  texto_versao     text,                 -- versão do aviso/termo apresentado (ex.: 'aviso-privacidade-v1')
  canal            text NOT NULL CHECK (canal IN ('whatsapp', 'instagram', 'manual')),
  interacao_id     uuid REFERENCES interacoes (id),
  forma            text,                 -- ex.: 'botao_aceito', 'palavra_SAIR', 'pedido_verbal_registrado'
  registrado_em    timestamptz NOT NULL DEFAULT now(),
  registrado_por   text NOT NULL
);
CREATE INDEX preferencias_lead_idx ON preferencias_contato (lead_id, finalidade, registrado_em DESC);
CREATE TRIGGER preferencias_imutavel BEFORE UPDATE OR DELETE ON preferencias_contato
  FOR EACH ROW EXECUTE FUNCTION tg_somente_insercao();

CREATE VIEW v_preferencias_vigentes AS
SELECT DISTINCT ON (lead_id, finalidade) lead_id, finalidade, estado, base_legal, texto_versao, registrado_em
FROM preferencias_contato
ORDER BY lead_id, finalidade, registrado_em DESC, id;

-- ---------------------------------------------------------------------------
-- contratos (honorários ficam em tabela separada para restringir acesso)
-- ---------------------------------------------------------------------------

CREATE TABLE contratos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id              uuid NOT NULL REFERENCES leads (id),
  status               text NOT NULL CHECK (status IN ('em_negociacao', 'assinado', 'cancelado', 'nao_fechado')),
  contratado_em        date,
  publicacao_origem_id uuid REFERENCES publicacoes (id),   -- cópia da origem considerada no fechamento
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'assinado' OR contratado_em IS NOT NULL)
);
CREATE INDEX contratos_lead_idx ON contratos (lead_id);
CREATE INDEX contratos_publicacao_idx ON contratos (publicacao_origem_id);
CREATE TRIGGER contratos_atualizado_em BEFORE UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION tg_atualizado_em();

CREATE TABLE contratos_honorarios (
  contrato_id        uuid PRIMARY KEY REFERENCES contratos (id) ON DELETE CASCADE,
  valor_centavos     bigint CHECK (valor_centavos >= 0),
  observacao         text,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- auditoria
-- ---------------------------------------------------------------------------

CREATE TABLE auditoria (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ator         text NOT NULL,          -- usuário interno ou processo (ex.: 'n8n:WF05_Upsert_Lead')
  acao         text NOT NULL,          -- ex.: 'lead.criado', 'origem.corrigida', 'automacao.pausada'
  entidade     text NOT NULL,
  entidade_id  text,
  ocorrido_em  timestamptz NOT NULL DEFAULT now(),
  metadados    jsonb CHECK (metadados IS NULL OR pg_column_size(metadados) <= 2048)
);
CREATE INDEX auditoria_entidade_idx ON auditoria (entidade, entidade_id, ocorrido_em);
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION tg_somente_insercao();

-- ---------------------------------------------------------------------------
-- Funções de negócio usadas pelos workflows
-- ---------------------------------------------------------------------------

-- WF05: obtém ou cria o lead de uma identidade de canal, sem duplicar sob concorrência.
CREATE FUNCTION upsert_lead(
  p_canal text, p_id_externo text, p_canal_entrada text, p_ocorrido_em timestamptz,
  p_nome text DEFAULT NULL, p_ator text DEFAULT 'sistema'
) RETURNS TABLE (lead_id uuid, criado boolean) LANGUAGE plpgsql AS $$
DECLARE
  v_lead uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_canal || ':' || p_id_externo, 0));

  SELECT i.lead_id INTO v_lead FROM lead_identidades i WHERE i.canal = p_canal AND i.id_externo = p_id_externo;
  IF FOUND THEN
    UPDATE leads l SET
      ultima_interacao_em = greatest(l.ultima_interacao_em, p_ocorrido_em),
      nome = coalesce(l.nome, p_nome)
    WHERE l.id = v_lead;
    RETURN QUERY SELECT v_lead, false;
    RETURN;
  END IF;

  PERFORM set_config('leadprev.ator', p_ator, true);
  INSERT INTO leads (nome, canal_entrada, primeiro_contato_em, ultima_interacao_em)
  VALUES (p_nome, p_canal_entrada, p_ocorrido_em, p_ocorrido_em)
  RETURNING id INTO v_lead;
  INSERT INTO lead_identidades (lead_id, canal, id_externo) VALUES (v_lead, p_canal, p_id_externo);
  INSERT INTO auditoria (ator, acao, entidade, entidade_id) VALUES (p_ator, 'lead.criado', 'leads', v_lead::text);
  RETURN QUERY SELECT v_lead, true;
END $$;

-- WF04: registra uma origem. A primeira origem de um lead é preservada; as demais viram histórico.
-- O código é normalizado; código desconhecido fica registrado com confiança baixa e sem publicação.
CREATE FUNCTION registrar_origem(
  p_lead_id uuid, p_canal text, p_metodo text, p_codigo text DEFAULT NULL,
  p_id_externo_publicacao text DEFAULT NULL, p_campanha text DEFAULT NULL,
  p_metadados jsonb DEFAULT NULL, p_interacao_id uuid DEFAULT NULL, p_ator text DEFAULT 'sistema'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_codigo     text := nullif(upper(btrim(p_codigo)), '');
  v_publicacao uuid;
  v_confianca  text;
  v_metodo     text := p_metodo;
  v_id         uuid;
BEGIN
  IF v_codigo IS NOT NULL THEN
    SELECT id INTO v_publicacao FROM publicacoes WHERE codigo = v_codigo;
  END IF;
  IF v_publicacao IS NULL AND p_id_externo_publicacao IS NOT NULL THEN
    SELECT id INTO v_publicacao FROM publicacoes WHERE id_externo = p_id_externo_publicacao;
  END IF;

  v_confianca := CASE
    WHEN v_metodo = 'unknown' THEN 'nenhuma'
    WHEN v_publicacao IS NULL THEN 'baixa'                    -- código ou post não cadastrado
    WHEN v_metodo IN ('direct', 'ad_metadata') THEN 'alta'      -- dado entregue pela própria Meta
    WHEN v_metodo = 'link_code' THEN 'alta'                    -- código chegou na mensagem enviada pela pessoa
    ELSE 'media'                                               -- manual
  END;
  IF v_metodo = 'unknown' THEN v_publicacao := NULL; END IF;

  BEGIN
    INSERT INTO lead_origens (lead_id, publicacao_id, canal, metodo, confianca, codigo_informado, campanha,
                              metadados, eh_primeira, interacao_id, registrado_por)
    VALUES (p_lead_id, v_publicacao, p_canal, v_metodo, v_confianca, left(p_codigo, 64), p_campanha,
            p_metadados, NOT EXISTS (SELECT 1 FROM lead_origens o WHERE o.lead_id = p_lead_id AND o.eh_primeira),
            p_interacao_id, p_ator)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- outra transação gravou a primeira origem ao mesmo tempo: esta vira histórico
    INSERT INTO lead_origens (lead_id, publicacao_id, canal, metodo, confianca, codigo_informado, campanha,
                              metadados, eh_primeira, interacao_id, registrado_por)
    VALUES (p_lead_id, v_publicacao, p_canal, v_metodo, v_confianca, left(p_codigo, 64), p_campanha,
            p_metadados, false, p_interacao_id, p_ator)
    RETURNING id INTO v_id;
  END;
  RETURN v_id;
END $$;

-- Retenção: apaga o texto das mensagens vencidas, preservando os metadados para métricas.
CREATE FUNCTION expurgar_conteudo_expirado() RETURNS integer LANGUAGE sql AS $$
  WITH x AS (
    UPDATE interacoes SET conteudo_texto = NULL, conteudo_expira_em = NULL
    WHERE conteudo_expira_em < now()
    RETURNING 1
  ) SELECT count(*)::int FROM x;
$$;

-- ---------------------------------------------------------------------------
-- Visões de relatório (WF12)
-- ---------------------------------------------------------------------------

CREATE VIEW v_origem_inicial AS
SELECT o.lead_id, o.publicacao_id, p.codigo, o.canal, o.metodo, o.confianca, o.registrado_em
FROM lead_origens o
LEFT JOIN publicacoes p ON p.id = o.publicacao_id
WHERE o.eh_primeira;

-- Origem considerada nos relatórios: a correção manual mais recente, se houver; senão, a primeira.
CREATE VIEW v_origem_efetiva AS
SELECT DISTINCT ON (o.lead_id) o.lead_id, o.publicacao_id, o.metodo, o.confianca
FROM lead_origens o
WHERE o.eh_primeira OR o.corrige_origem_id IS NOT NULL
ORDER BY o.lead_id, (o.corrige_origem_id IS NOT NULL) DESC, o.registrado_em DESC, o.id;

CREATE VIEW v_funil_por_publicacao AS
SELECT
  coalesce(p.codigo, 'DESCONHECIDA') AS publicacao,
  p.beneficio,
  count(*)                                                              AS leads,
  count(*) FILTER (WHERE l.status NOT IN ('novo_contato'))               AS iniciaram_triagem,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM lead_status_historico h
                                 WHERE h.lead_id = l.id AND h.status_para = 'pendente_analise_juridica')) AS encaminhados_revisao,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM lead_status_historico h
                                 WHERE h.lead_id = l.id AND h.status_para = 'analise_realizada'))         AS analises_realizadas,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM contratos c
                                 WHERE c.lead_id = l.id AND c.status = 'assinado'))                      AS contratos_assinados
FROM leads l
LEFT JOIN v_origem_efetiva o ON o.lead_id = l.id
LEFT JOIN publicacoes p ON p.id = o.publicacao_id
GROUP BY 1, 2;

COMMIT;
