## Objetivo
Garantir que o login fique persistido no dispositivo: ao fechar a aba/app e reabrir, o usuário volta direto para `/atividades` sem precisar digitar e-mail e senha. O logoff só acontece quando ele clicar em **Sair**.

## Diagnóstico
- O cliente Supabase já está configurado com `persistSession: true` e `localStorage` (`src/integrations/supabase/client.ts`), então a sessão *já é* salva no navegador.
- O problema percebido é comportamental: ao reabrir o app o usuário cai na **landing page** (`/`) com botão "Entrar", dando a impressão de que precisa logar de novo. O redirect existente em `src/routes/index.tsx` roda em `beforeLoad`, mas:
  - Depende de `supabase.auth.getSession()` assíncrono → a landing pisca antes do redirect.
  - No PWA instalado na tela inicial, o `start_url` do `manifest.webmanifest` também aponta para `/`, reforçando a sensação de "fui deslogado".
- Não há nenhum `signOut` automático fora do botão Sair (verificado em `redefinir-senha`, `auth.tsx` no fluxo de cadastro e `aguardando-aprovacao`). Ou seja, a sessão realmente persiste — falta só levar o usuário direto para dentro do app.

## Mudanças propostas (somente frontend, sem tocar em auth/DB)

1. **`src/routes/index.tsx`**
   - Manter o `beforeLoad` que redireciona para `/atividades` quando há sessão.
   - Adicionar uma checagem síncrona no componente (`useEffect` com `supabase.auth.getSession()`) que redireciona também quando a sessão só fica disponível após hidratação, evitando o flash da landing.
   - Enquanto a checagem inicial não termina, renderizar um placeholder neutro (spinner/tela em branco com marca) em vez da landing completa — some assim que a sessão for confirmada ou negada.

2. **`public/manifest.webmanifest`**
   - Trocar `start_url` para `/atividades` (com `scope: "/"`), para que o PWA instalado abra direto na área autenticada. Usuários sem sessão continuam sendo mandados para `/auth` pelo gate de `_authenticated`.

3. **Confirmar persistência (sem mudanças de código)**
   - Reforçar no fluxo de cadastro em `src/routes/auth.tsx` que os `signOut()` existentes ali são intencionais (apenas quando o cadastro cria sessão automática antes da aprovação) — nenhum outro caminho desloga o usuário.
   - Documentar mentalmente: o único `signOut` disparado pelo usuário fica no botão **Sair** do header (`src/routes/_authenticated/route.tsx`) e no botão Sair de `aguardando-aprovacao`.

## Fora de escopo
- Não alterar `supabase/client.ts`, RLS, middlewares, nem fluxo de aprovação.
- Não mudar o botão Sair — ele continua fazendo logoff imediato e voltando para `/auth`.

## Verificação após implementar
- `bunx tsgo --noEmit`.
- Testar no preview: logar → fechar aba → reabrir `/` → deve cair em `/atividades` sem pedir senha.
- Testar botão **Sair**: deve voltar para `/auth` e exigir e-mail/senha para entrar de novo.
