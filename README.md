# Cronograma da Tese

Aplicação web simples (sem login) para gerir as tarefas e o cronograma da tese: lista de tarefas por categoria/capítulo, prazos, prioridades e um calendário mensal.

## Testar localmente

```bash
pip install -r requirements.txt
python app.py
```

Depois abre http://127.0.0.1:5000 no browser.

## Colocar no Render (acesso pela internet)

### Passo 1 — Colocar o código no GitHub
1. Cria um repositório novo no GitHub (pode ser privado).
2. Dentro desta pasta:
   ```bash
   git init
   git add .
   git commit -m "Primeira versão do cronograma da tese"
   git branch -M main
   git remote add origin https://github.com/TEU-UTILIZADOR/NOME-DO-REPO.git
   git push -u origin main
   ```

### Passo 2 — Criar o serviço no Render
1. Cria conta em https://render.com (podes entrar com o GitHub).
2. No dashboard, clica **New +** → **Blueprint**, e escolhe o repositório — o Render lê automaticamente o ficheiro `render.yaml` incluído aqui e configura tudo.
   - Alternativa manual: **New +** → **Web Service**, escolhe o repositório, e usa:
     - **Build Command:** `pip install -r requirements.txt`
     - **Start Command:** `gunicorn app:app`
     - **Plan:** Free
3. Clica **Deploy**. Após 1–2 minutos, o Render dá-te um URL do tipo `https://cronograma-tese.onrender.com` — é esse o link para acederes de qualquer lugar.

### ⚠️ Importante sobre persistência dos dados
O plano **Free** do Render tem disco *não-persistente*: sempre que fizeres um novo deploy (ou o serviço reiniciar), o ficheiro SQLite é apagado e as tarefas perdem-se. Para uma tese isto é arriscado, por isso recomendo uma destas opções:

**Opção A (recomendada, grátis por 90 dias): usar uma base de dados PostgreSQL do Render**
1. No dashboard do Render: **New +** → **PostgreSQL** → plano Free → cria.
2. Copia o **Internal Database URL** que o Render mostra.
3. No teu Web Service → **Environment** → adiciona a variável:
   - `DATABASE_URL` = (cola o URL copiado)
4. Faz **Manual Deploy** novamente. A app deteta automaticamente o `DATABASE_URL` e passa a usar PostgreSQL, que é persistente.
   - Nota: a base de dados Free do Render expira 90 dias depois de criada — nessa altura crias outra e voltas a colar o novo `DATABASE_URL` (perde-se os dados nessa migração, a menos que exportes antes).

**Opção B: disco persistente pago**
No plano Starter ($7/mês) podes adicionar um "Persistent Disk" e montar em `/opt/render/project/src/instance`, mantendo o SQLite entre deploys sem precisar de Postgres.

Sem fazer nenhuma destas alterações, a app funciona perfeitamente — só perde as tarefas nos redeploys/reinícios, não durante o uso normal do dia a dia.

## Estrutura do projeto

```
app.py               # backend Flask (API REST + base de dados)
templates/index.html # página principal
static/style.css     # estilo
static/app.js        # lógica do calendário, lista de tarefas, formulário
requirements.txt     # dependências Python
Procfile              # comando de arranque para o Render
render.yaml           # configuração automática do Render (Blueprint)
```

## Funcionalidades
- Adicionar/editar/eliminar tarefas com título, notas, categoria (capítulo/fase da tese), data limite, prioridade e estado.
- Calendário mensal com indicação visual dos prazos por prioridade; clicar num dia filtra a lista.
- Barra de progresso por categoria ("estante" de capítulos) e progresso geral.
- Filtros por estado (a fazer / em curso / concluída) e por categoria.
- Sem necessidade de login — pensado para uso individual.
