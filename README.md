# Pier Manutenção

Sistema para controlar os itens do setor de manutenção: entradas (compras), saídas, trocas de peças, empréstimos de ferramentas com devolução, histórico e painel para a administração.

- **Site:** publicado pelo GitHub Pages a partir deste repositório.
- **Dados:** ficam na planilha do Google "Estoque da Manutenção" (abas Itens, Movimentacoes, Emprestimos e Config).
- **Ligação entre os dois:** o código em `apps-script/Codigo.gs`, instalado na planilha em Extensões → Apps Script.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html`, `estilo.css`, `app.js` | O site |
| `config.js` | Endereço do Apps Script (link do App da Web, termina em `/exec`) |
| `apps-script/Codigo.gs` | Código que lê e grava na planilha |

## Usuários e permissões

Os logins e perfis são gerenciados no próprio site, na aba **Usuários** (só aparece para quem tem essa permissão). Também ficam visíveis na planilha:

- **Aba Usuarios:** usuário, nome do colaborador, senha, perfil e se está ativo. O nome é o que aparece em "Registrado por" no histórico.
- **Aba Perfis:** o que cada perfil pode fazer (Sim ou Não em cada permissão). O perfil **Administração** sempre tem acesso total.

O servidor confere a permissão em cada ação, então esconder um botão não é a única proteção.

## Dashboard

A aba **Dashboard** mostra, para o período escolhido: retiradas, compras, empréstimos, estoque crítico, valor estimado do estoque (pelo último preço de compra de cada item), itens parados, gráficos por dia ou mês, itens mais retirados, destinos, colaboradores, categorias, fornecedores, trocas e o consumo detalhado por item, com exportação em CSV.

Os dados do estoque e as senhas não ficam neste repositório, só na planilha.

## Ordens de serviço

A aba **OS** registra pedidos de serviço: local, categoria, prioridade com prazo, responsável, fotos de antes e depois (salvas na pasta "Fotos das OS - Estoque da Manutenção", ao lado da planilha) e os materiais retirados do estoque pela OS. O andamento fica numa linha do tempo e na coluna Andamento da aba **OS** da planilha. As permissões Ver, Abrir, Atender e Gerenciar OS ficam na aba **Perfis**.

## Importar inventário

Em **Itens → Importar inventário**, envie a planilha da contagem (.xlsx ou .csv). O sistema acha as colunas pelo título (Código, Item, Especificação, Categoria, Tipo, Un., Saldo atual ou Quantidade, Estoque mínimo, Localização, Observações), mostra uma prévia e grava a diferença de cada item como ajuste no histórico. Antes de gravar, guarda uma cópia oculta da aba Itens.

## Se mudar o código do Apps Script

Depois de colar uma versão nova, rode a função `autorizar` uma vez pelo editor (quando o código pedir uma permissão nova, como o Drive das fotos) e use **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**. Assim o link continua o mesmo e o `config.js` não precisa mudar.
