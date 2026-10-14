# Thesis Schedule

A simple web application (without login) for managing thesis tasks and timelines: task lists by category/chapter, deadlines, priorities, and a monthly calendar.

## Run Locally

```bash
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:5000 in your browser.

## Deploy to Render (Internet Access)

### Step 1 — Upload the Code to GitHub

1. Create a new GitHub repository (it can be private).
2. Inside this folder:

   ```bash
   git init
   git add .
   git commit -m "Initial thesis schedule version"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/REPOSITORY-NAME.git
   git push -u origin main
   ```

### Step 2 — Create the Service on Render

1. Create an account at https://render.com (you can sign in with GitHub).
2. In the dashboard, click **New +** → **Blueprint**, and select the repository. Render will automatically read the included `render.yaml` file and configure everything.
   - Manual alternative: **New +** → **Web Service**, select the repository, and use:
     - **Build Command:** `pip install -r requirements.txt`
     - **Start Command:** `gunicorn app:app`
     - **Plan:** Free
3. Click **Deploy**. After 1–2 minutes, Render will provide a URL such as `https://thesis-schedule.onrender.com` — this is the link you can use to access the application from anywhere.

### ⚠️ Important About Data Persistence

The **Free** Render plan uses *non-persistent* storage: whenever you redeploy the service (or it restarts), the SQLite database file is deleted and all tasks are lost. For a thesis project, this can be risky, so I recommend one of the following options:

**Option A (recommended, free for 90 days): Use a PostgreSQL database on Render**

1. In the Render dashboard: **New +** → **PostgreSQL** → Free plan → Create.
2. Copy the **Internal Database URL** displayed by Render.
3. Go to your Web Service → **Environment** → add the variable:
   - `DATABASE_URL` = (paste the copied URL)
4. Run **Manual Deploy** again. The application automatically detects `DATABASE_URL` and switches to PostgreSQL, which provides persistent storage.
   - Note: The free Render PostgreSQL database expires 90 days after creation. At that point, create a new one and update the `DATABASE_URL` (unless you export the data beforehand, the existing data will be lost during migration).

**Option B: Paid Persistent Disk**

With the Starter plan ($7/month), you can add a Persistent Disk and mount it at `/opt/render/project/src/instance`, allowing SQLite data to remain available between deployments without needing PostgreSQL.

Without either of these options, the application works perfectly fine — it will only lose data after redeployments or service restarts, not during normal daily use.

## Project Structure

```text
app.py               # Flask backend (REST API + database)
templates/index.html # Main page
static/style.css     # Styling
static/app.js        # Calendar, task list and form logic
requirements.txt     # Python dependencies
Procfile             # Startup command for Render
render.yaml          # Automatic Render configuration (Blueprint)
```

## Features

- Add, edit, and delete tasks with title, notes, category (thesis chapter/phase), deadline, priority, and status.
- Monthly calendar with visual deadline indicators based on priority; clicking a day filters the task list.
- Progress tracking by category ("chapter bookshelf") and overall progress.
- Filters by status (To Do / In Progress / Completed) and by category.
- No login required — designed for individual use.
