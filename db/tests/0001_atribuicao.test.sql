-- Testes do rastreamento por publicação e da deduplicação (dados fictícios).
-- Executar com: db/tests/run.sh   (cria um banco temporário, aplica as migrações e roda este arquivo)
\set ON_ERROR_STOP on
SET search_path TO leadprev;
SET client_min_messages TO warning;

CREATE FUNCTION pg_temp.afirmar(cond boolean, nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', nome; END IF;
  RAISE NOTICE 'ok - %', nome;
END $$;
SET client_min_messages TO notice;

INSERT INTO publicacoes (codigo, plataforma, id_externo, tema, beneficio, status) VALUES
  ('AR001', 'instagram', '17890000000000001', 'Aposentadoria rural: documentos', 'aposentadoria_rural', 'publicada'),
  ('AR002', 'instagram', '17890000000000002', 'Aposentadoria rural: negativa do INSS', 'aposentadoria_rural', 'publicada'),
  ('SMR001', 'instagram', NULL, 'Salário-maternidade rural: requisitos', 'salario_maternidade_rural', 'publicada');

-- T01: link com código conhecido vira primeira origem, confiança alta
DO $$
DECLARE l uuid; o uuid; r record;
BEGIN
  SELECT lead_id INTO l FROM upsert_lead('whatsapp', '5599900000001', 'whatsapp', now(), 'Lead Ficticio 1', 'teste');
  o := registrar_origem(l, 'whatsapp', 'link_code', 'AR001', p_ator => 'teste');
  SELECT * INTO r FROM v_origem_inicial WHERE lead_id = l;
  PERFORM pg_temp.afirmar(r.codigo = 'AR001' AND r.metodo = 'link_code' AND r.confianca = 'alta', 'T01 link_code conhecido');
END $$;

-- T02: evento repetido da Meta não duplica interação
DO $$
DECLARE n int;
BEGIN
  INSERT INTO interacoes (canal, direcao, tipo, id_externo, ocorrido_em) VALUES ('whatsapp', 'entrada', 'texto', 'wamid.TESTE1', now())
    ON CONFLICT DO NOTHING;
  INSERT INTO interacoes (canal, direcao, tipo, id_externo, ocorrido_em) VALUES ('whatsapp', 'entrada', 'texto', 'wamid.TESTE1', now())
    ON CONFLICT DO NOTHING;
  SELECT count(*) INTO n FROM interacoes WHERE id_externo = 'wamid.TESTE1';
  PERFORM pg_temp.afirmar(n = 1, 'T02 evento duplicado ignorado');
END $$;

-- T03: segunda origem não sobrescreve a primeira
DO $$
DECLARE l uuid; n int;
BEGIN
  SELECT i.lead_id INTO l FROM lead_identidades i WHERE id_externo = '5599900000001';
  PERFORM registrar_origem(l, 'instagram_direct', 'direct', p_id_externo_publicacao => '17890000000000002', p_ator => 'teste');
  SELECT count(*) INTO n FROM lead_origens WHERE lead_id = l;
  PERFORM pg_temp.afirmar(n = 2, 'T03a histórico guarda as duas origens');
  PERFORM pg_temp.afirmar((SELECT codigo FROM v_origem_inicial WHERE lead_id = l) = 'AR001', 'T03b primeira origem preservada');
END $$;

-- T04: código desconhecido é registrado com confiança baixa e sem publicação
DO $$
DECLARE l uuid; r record;
BEGIN
  SELECT lead_id INTO l FROM upsert_lead('whatsapp', '5599900000002', 'whatsapp', now(), NULL, 'teste');
  PERFORM registrar_origem(l, 'whatsapp', 'link_code', 'XX999', p_ator => 'teste');
  SELECT * INTO r FROM lead_origens WHERE lead_id = l;
  PERFORM pg_temp.afirmar(r.publicacao_id IS NULL AND r.confianca = 'baixa' AND r.codigo_informado = 'XX999',
                          'T04 código desconhecido marcado como baixa confiança');
END $$;

-- T05: sem nenhum dado de origem -> unknown / nenhuma
DO $$
DECLARE l uuid; r record;
BEGIN
  SELECT lead_id INTO l FROM upsert_lead('whatsapp', '5599900000003', 'whatsapp', now(), NULL, 'teste');
  PERFORM registrar_origem(l, 'whatsapp', 'unknown', p_ator => 'teste');
  SELECT * INTO r FROM lead_origens WHERE lead_id = l;
  PERFORM pg_temp.afirmar(r.metodo = 'unknown' AND r.confianca = 'nenhuma' AND r.publicacao_id IS NULL, 'T05 origem desconhecida explícita');
END $$;

-- T06: código com espaços/minúsculas é normalizado
DO $$
DECLARE l uuid;
BEGIN
  SELECT lead_id INTO l FROM upsert_lead('whatsapp', '5599900000004', 'whatsapp', now(), NULL, 'teste');
  PERFORM registrar_origem(l, 'whatsapp', 'link_code', '  smr001 ', p_ator => 'teste');
  PERFORM pg_temp.afirmar((SELECT codigo FROM v_origem_inicial WHERE lead_id = l) = 'SMR001', 'T06 código normalizado');
END $$;

-- T07: origens são imutáveis
DO $$
BEGIN
  BEGIN
    UPDATE lead_origens SET confianca = 'media';
    PERFORM pg_temp.afirmar(false, 'T07a UPDATE em lead_origens deveria falhar');
  EXCEPTION WHEN restrict_violation THEN
    PERFORM pg_temp.afirmar(true, 'T07a UPDATE em lead_origens bloqueado');
  END;
  BEGIN
    DELETE FROM lead_origens;
    PERFORM pg_temp.afirmar(false, 'T07b DELETE em lead_origens deveria falhar');
  EXCEPTION WHEN restrict_violation THEN
    PERFORM pg_temp.afirmar(true, 'T07b DELETE em lead_origens bloqueado');
  END;
END $$;

-- T08: correção manual muda a origem efetiva sem apagar a inicial
DO $$
DECLARE l uuid; errada uuid; pub uuid;
BEGIN
  SELECT i.lead_id INTO l FROM lead_identidades i WHERE id_externo = '5599900000002';
  SELECT id INTO errada FROM lead_origens WHERE lead_id = l AND eh_primeira;
  SELECT id INTO pub FROM publicacoes WHERE codigo = 'AR002';
  INSERT INTO lead_origens (lead_id, publicacao_id, canal, metodo, confianca, eh_primeira, corrige_origem_id, registrado_por)
  VALUES (l, pub, 'manual', 'manual', 'media', false, errada, 'advogado');
  PERFORM pg_temp.afirmar((SELECT p.codigo FROM v_origem_efetiva e JOIN publicacoes p ON p.id = e.publicacao_id WHERE e.lead_id = l) = 'AR002',
                          'T08a origem efetiva usa a correção');
  PERFORM pg_temp.afirmar((SELECT codigo_informado FROM lead_origens WHERE id = errada) = 'XX999', 'T08b origem inicial intacta');
END $$;

-- T09: deduplicação por identidade; canais diferentes não são unidos automaticamente
DO $$
DECLARE a record; b record; c record;
BEGIN
  SELECT * INTO a FROM upsert_lead('whatsapp', '5599900000001', 'whatsapp', now(), 'Outro Nome', 'teste');
  PERFORM pg_temp.afirmar(NOT a.criado, 'T09a mesma identidade não cria lead novo');
  PERFORM pg_temp.afirmar((SELECT nome FROM leads WHERE id = a.lead_id) = 'Lead Ficticio 1', 'T09b nome existente não é sobrescrito');
  SELECT * INTO c FROM upsert_lead('instagram', '5599900000001', 'instagram_direct', now(), 'Lead Ficticio 1', 'teste');
  PERFORM pg_temp.afirmar(c.criado AND c.lead_id <> a.lead_id, 'T09c Instagram com mesmo número/nome não é unido sozinho');
END $$;

-- T10: anúncio/post identificado pelo ID externo da Meta
DO $$
DECLARE l uuid;
BEGIN
  SELECT lead_id INTO l FROM upsert_lead('whatsapp', '5599900000005', 'whatsapp', now(), NULL, 'teste');
  PERFORM registrar_origem(l, 'whatsapp', 'ad_metadata', p_id_externo_publicacao => '17890000000000001',
                           p_campanha => 'ad_ficticio_1', p_metadados => '{"source_type":"post"}', p_ator => 'teste');
  PERFORM pg_temp.afirmar((SELECT codigo FROM v_origem_inicial WHERE lead_id = l) = 'AR001', 'T10 ad_metadata resolve pelo id do post');
END $$;

-- T11: status inválido rejeitado e histórico de status registrado
DO $$
DECLARE l uuid; n int;
BEGIN
  SELECT i.lead_id INTO l FROM lead_identidades i WHERE id_externo = '5599900000001' AND canal = 'whatsapp';
  BEGIN
    UPDATE leads SET status = 'qualificado' WHERE id = l;
    PERFORM pg_temp.afirmar(false, 'T11a status fora do pipeline deveria falhar');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.afirmar(true, 'T11a status fora do pipeline rejeitado');
  END;
  UPDATE leads SET status = 'triagem_em_andamento' WHERE id = l;
  UPDATE leads SET status = 'pendente_analise_juridica' WHERE id = l;
  SELECT count(*) INTO n FROM lead_status_historico WHERE lead_id = l;
  PERFORM pg_temp.afirmar(n = 3, 'T11b histórico de status (criação + 2 mudanças)');
END $$;

-- T12: pausa da automação exige motivo
DO $$
DECLARE l uuid;
BEGIN
  SELECT i.lead_id INTO l FROM lead_identidades i WHERE id_externo = '5599900000003';
  BEGIN
    UPDATE leads SET automacao_pausada = true WHERE id = l;
    PERFORM pg_temp.afirmar(false, 'T12 pausa sem motivo deveria falhar');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.afirmar(true, 'T12 pausa sem motivo rejeitada');
  END;
END $$;

-- T13: relatório por publicação
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM v_funil_por_publicacao WHERE publicacao = 'AR001';
  -- AR001: lead 1 (link) e lead 5 (anúncio)
  PERFORM pg_temp.afirmar(r.leads = 2 AND r.encaminhados_revisao = 1, 'T13a funil AR001');
  SELECT * INTO r FROM v_funil_por_publicacao WHERE publicacao = 'DESCONHECIDA';
  -- lead 3 (unknown) e o lead do Instagram sem origem registrada
  PERFORM pg_temp.afirmar(r.leads = 2, 'T13b leads sem origem aparecem como DESCONHECIDA');
END $$;

-- T14: retenção apaga o texto e mantém o registro
DO $$
DECLARE n int;
BEGIN
  INSERT INTO interacoes (canal, direcao, tipo, id_externo, ocorrido_em, conteudo_texto, conteudo_expira_em)
  VALUES ('whatsapp', 'entrada', 'texto', 'wamid.TESTE2', now(), 'texto ficticio', now() - interval '1 minute');
  n := expurgar_conteudo_expirado();
  PERFORM pg_temp.afirmar(n = 1 AND (SELECT conteudo_texto FROM interacoes WHERE id_externo = 'wamid.TESTE2') IS NULL,
                          'T14 expurgo de conteúdo vencido');
END $$;
