# Mapa dos indicadores: formulário → fonte automática

Levantamento dos 7 formulários "Preencher Indicadores" / "Report Semanal de Indicadores" (out/2026).
Para cada campo: de onde pode vir sem ninguém preencher, e se aparece para o cliente.

Legenda da fonte:

- **ClickUp**: tarefas das listas do cliente (status, prazo, data de conclusão, etiquetas). Já coletado por `scripts/atividades.mjs`.
- **Meta**: API do Instagram e do Meta Ads, com o token da Mantora. Stories só ficam disponíveis por 24 h, então essa coleta é diária.
- **Vendas**: plataforma de vendas do cliente (Hotmart, Kiwify…), com UTM para separar orgânico e pago.
- **GA4 / Clarity / PageSpeed**: Google Analytics, Microsoft Clarity e PageSpeed Insights (grátis).
- **Manual**: continua no formulário (texto, avaliação ou algo que não existe em sistema).

Campos comuns a todos (Nome da tarefa, Responsável, Período, Cadência, Cliente) podem ser preenchidos sozinhos. **Leitura do período** continua manual em todos e vira matéria-prima dos destaques do relatório.

## Carol · Conteúdo orgânico

| Campo | Fonte | Cliente vê? |
|---|---|---|
| Conteúdos publicados | ClickUp (Calendário finalizado) + Meta | Sim |
| Alcance e visualizações · Orgânico | Meta | Sim |
| Interações · Orgânico | Meta | Sim |
| Novos seguidores orgânicos | Meta (total). A separação orgânico × pago é estimada descontando os seguidores atribuídos aos anúncios | Sim |
| Média alcance feed | Meta | Sim |
| Média visualizações stories | Meta (coleta diária) | Sim |
| Toques link bio · Orgânico | Meta | Sim |
| Melhor post do período | Meta (ranking por alcance/interações) | Sim |
| Ativações ManyChat · Orgânico | ManyChat API (a confirmar o que o plano do cliente expõe) | Sim |
| Leads gerados · Orgânico | ManyChat / ferramenta de captura | Sim |
| Vendas · Orgânico | Vendas (com UTM) | Sim |
| Faturamento orgânico | Vendas (com UTM) | Sim |
| Visitas ao blog · Orgânico | GA4 | Sim |
| Leitores únicos blog · Orgânico | GA4 | Sim |
| Comparativo entre canais | Rascunho por IA a partir dos dados, revisado | Sim |
| Depoimentos sobre conteúdo | Manual (curadoria), com varredura de comentários como apoio | Sim |

## Camila · Copy e funil

| Campo | Fonte | Cliente vê? |
|---|---|---|
| Faturamento gerado | Vendas | Sim |
| Lucro gerado | Vendas − custos (investimento do Meta Ads + custos fixos no config) | Sim |
| % Lucro dos clientes · Funil | Calculado de faturamento e lucro | Sim |
| ROI da conta · Funil | Calculado (Vendas ÷ investimento Meta) | Sim |
| Novos clientes/vendas · Funil | Vendas | Sim |
| Leads gerados · Funil | Ferramenta de captura / e-mail | Sim |
| Taxa de conversão order bump | Vendas | Sim |
| Taxa de conversão upsell | Vendas | Sim |
| Mapa de calor até botão | Clarity (profundidade de rolagem e cliques) | Sim |
| Quantidade de otimizações realizadas | ClickUp (tarefas de copy/funil concluídas) | Sim, como entrega |
| Indicações de concorrentes | Manual | Sim, como marco |
| Recomendações de novos produtos | Manual | Sim, como marco |

## Karine · Edição de vídeo

| Campo | Fonte | Cliente vê? |
|---|---|---|
| Número de edições semana/mês | ClickUp (Edição de vídeo finalizado) | Sim |
| Alcance dos vídeos editados | Meta (Reels), cruzando com as tarefas editadas | Sim |
| Retenção inicial dos vídeos | Meta (tempo médio assistido e taxa de pulo dos Reels) | Sim |
| Número de atrasos | ClickUp (concluído depois do prazo) | Não |
| Edição entregue com 2 dias de antecedência | ClickUp (campo "Entrega Edição de vídeo" × data de publicação) | Não |
| Vídeos com erro de legenda e outros | ClickUp (vezes que a tarefa passou por "alteração vídeo"; exige o ClickApp Tempo em Status) | Não |
| Vídeos editados 90% por IA | Etiqueta `ia` na tarefa | Não |

## Fernanda · Design

| Campo | Fonte | Cliente vê? |
|---|---|---|
| Número de artes semana/mês | ClickUp (design finalizado) | Sim |
| Alcance das imagens editadas | Meta (posts de imagem/carrossel), cruzando com as tarefas | Sim |
| Número de atrasos | ClickUp | Não |
| Arte entregue com 2 dias de antecedência | ClickUp (campo "Entrega design" × data de publicação) | Não |
| Artes que voltaram com erros | ClickUp (passagens por "alteração design") | Não |
| % de telas feitas por automação | Etiqueta `automacao` na tarefa | Não |

## Clarisse · Tecnologia e automação

| Campo | Fonte | Cliente vê? |
|---|---|---|
| Velocidade das páginas | PageSpeed Insights | Sim |
| Tempo economizado do processo automatizado | Manual (estimativa por automação, somada ao longo do tempo) | Sim |
| Implementação de testes | ClickUp (tarefas de teste concluídas) ou manual | Sim, como entrega |
| Possibilidades apresentadas | ClickUp (tarefa recorrente "Apresentar possibilidades") ou manual | Sim, como marco |
| Taxa de adoção de ferramenta | Manual | Não |
| ROI / Custos de APIs | Painéis de cobrança das APIs (semi) | Não |
| Segurança nos sistemas | Manual | Não |

## Thaynara · Gestão de projetos

| Campo | Fonte | Cliente vê? |
|---|---|---|
| SLA de entrega (% no prazo) | ClickUp (concluído até o prazo ÷ total com prazo no período) | Sim, por cliente |
| NPS | Manual ou pesquisa enviada aos clientes | Não |
| Retenção de clientes (%) | ClickUp (pasta "Clientes Ativos" mês a mês) | Não |

## Emerson · Comercial da Mantora

Indicadores da própria agência, não do cliente. Ficam no painel interno.

| Campo | Fonte |
|---|---|
| Pessoas abordadas ativamente, Leads comercial, MQL, Reuniões agendadas, Volume de follow up | CRM, se houver; senão manual |
| Vendas realizadas, Ticket médio, Faturamento total, Tempo de conversão médio | CRM / plataforma de pagamento; senão manual |

## Tráfego pago

Não há formulário de tráfego entre os 7. Os campos do Report de tráfego já mapeados em `config/sabrina.json` (investimento, CPM, CTR, CPC, CPA, CPL, frequência, retenção, custo por seguidor, visitas ao perfil, vendas e leads por fase) vêm todos do **Meta Ads**. ROAS e faturamento de tráfego precisam de **Vendas** com UTM.
