# Estoque da Manutenção

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

## Logins

Cada pessoa tem uma linha na aba **Usuarios** da planilha: usuário, nome, senha, perfil (Manutenção ou Administração) e ativo (Sim ou Não). O nome dessa aba é o que aparece em "Registrado por" no histórico.

- **Manutenção:** registra movimentações e cadastra itens.
- **Administração:** também edita itens, ajusta estoque, estorna lançamentos e exporta o histórico.
- Para bloquear alguém, escreva **Não** na coluna Ativo.

Os dados do estoque e as senhas não ficam neste repositório, só na planilha.

## Se mudar o código do Apps Script

Depois de colar uma versão nova, use **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**. Assim o link continua o mesmo e o `config.js` não precisa mudar.
