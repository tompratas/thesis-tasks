import os
from datetime import datetime, date, timedelta

from flask import Flask, jsonify, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text

app = Flask(__name__, static_folder="static", template_folder="templates")

# --- Database config -------------------------------------------------
# Works out of the box with SQLite. If a DATABASE_URL env var is set
# (e.g. a Render PostgreSQL instance), it will be used instead so data
# survives redeploys on Render's free web-service tier.
db_url = os.environ.get("DATABASE_URL", "sqlite:///" + os.path.join(app.instance_path, "tasks.db"))
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)

os.makedirs(app.instance_path, exist_ok=True)
app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

STATUSES = ["todo", "doing", "done"]
PRIORITIES = ["low", "medium", "high"]

DEFAULT_PALETTE = [
    ("#ffd6e5", "#ff8fb1"),
    ("#ecdff9", "#b9a3e3"),
    ("#d7f7ea", "#6fd9b3"),
    ("#ffe9b3", "#f6b93b"),
    ("#ffd7da", "#ff6f7d"),
    ("#dcefff", "#6fb3e0"),
]


def week_monday(d):
    """Return the Monday (start of week) for any given date."""
    return d - timedelta(days=d.weekday())


class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    bg_color = db.Column(db.String(7), default="#ffd6e5")
    bar_color = db.Column(db.String(7), default="#ff8fb1")
    badge_bg = db.Column(db.String(7), default="#ffd6e5")
    badge_text = db.Column(db.String(7), default="#ff5c8a")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "bg_color": self.bg_color,
            "bar_color": self.bar_color,
            "badge_bg": self.badge_bg,
            "badge_text": self.badge_text,
        }


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    notes = db.Column(db.Text, default="")
    category_id = db.Column(db.Integer, db.ForeignKey("category.id"), nullable=True)
    category = db.relationship("Category")
    week_start = db.Column(db.Date, nullable=True)  # Monday of the focus week
    priority = db.Column(db.String(10), default="medium")
    status = db.Column(db.String(10), default="todo")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        week_end = (self.week_start + timedelta(days=6)) if self.week_start else None
        return {
            "id": self.id,
            "title": self.title,
            "notes": self.notes or "",
            "category_id": self.category_id,
            "category": self.category.to_dict() if self.category else None,
            "week_start": self.week_start.isoformat() if self.week_start else None,
            "week_end": week_end.isoformat() if week_end else None,
            "priority": self.priority,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Milestone(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    date = db.Column(db.Date, nullable=False)

    def to_dict(self):
        return {"id": self.id, "title": self.title, "date": self.date.isoformat()}


def run_light_migrations():
    """Add newly-introduced columns/tables to an already-existing database
    without wiping data, so things keep working across redeploys once a
    persistent Postgres database is attached."""
    inspector = inspect(db.engine)
    if "task" not in inspector.get_table_names():
        return

    cols = [c["name"] for c in inspector.get_columns("task")]

    with db.engine.connect() as conn:
        if "category" in inspector.get_table_names():
            cat_cols = [c["name"] for c in inspector.get_columns("category")]
            if "badge_bg" not in cat_cols:
                conn.execute(text("ALTER TABLE category ADD COLUMN badge_bg VARCHAR(7)"))
                conn.execute(text("UPDATE category SET badge_bg = bg_color WHERE badge_bg IS NULL"))
                conn.commit()
            if "badge_text" not in cat_cols:
                conn.execute(text("ALTER TABLE category ADD COLUMN badge_text VARCHAR(7)"))
                conn.execute(text("UPDATE category SET badge_text = bar_color WHERE badge_text IS NULL"))
                conn.commit()

        if "week_start" not in cols:
            conn.execute(text("ALTER TABLE task ADD COLUMN week_start DATE"))
            conn.commit()

        if "category_id" not in cols:
            conn.execute(text("ALTER TABLE task ADD COLUMN category_id INTEGER"))
            conn.commit()

            # Backfill: turn old free-text categories into real Category rows
            if "category" in cols:
                rows = conn.execute(text(
                    "SELECT DISTINCT category FROM task WHERE category IS NOT NULL AND category <> ''"
                )).fetchall()
                for i, row in enumerate(rows):
                    name = row[0]
                    existing = conn.execute(
                        text("SELECT id FROM category WHERE name = :name"), {"name": name}
                    ).fetchone()
                    if existing:
                        cat_id = existing[0]
                    else:
                        bg, bar = DEFAULT_PALETTE[i % len(DEFAULT_PALETTE)]
                        conn.execute(
                            text("INSERT INTO category (name, bg_color, bar_color, badge_bg, badge_text) VALUES (:name, :bg, :bar, :bg, :bar)"),
                            {"name": name, "bg": bg, "bar": bar},
                        )
                        conn.commit()
                        cat_id = conn.execute(
                            text("SELECT id FROM category WHERE name = :name"), {"name": name}
                        ).fetchone()[0]
                    conn.execute(
                        text("UPDATE task SET category_id = :cid WHERE category = :name"),
                        {"cid": cat_id, "name": name},
                    )
                conn.commit()


def seed_milestones():
    default_date = date(2026, 10, 31)
    exists = Milestone.query.filter_by(date=default_date).first()
    if not exists:
        db.session.add(Milestone(title="Entrega da tese", date=default_date))
        db.session.commit()


with app.app_context():
    db.create_all()
    run_light_migrations()
    seed_milestones()


def parse_date(value):
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


# --- Routes: pages ------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


# --- Routes: categories ---------------------------------------------------

@app.route("/api/categories", methods=["GET"])
def list_categories():
    categories = Category.query.order_by(Category.id.asc()).all()
    return jsonify([c.to_dict() for c in categories])


@app.route("/api/categories", methods=["POST"])
def create_category():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "O nome é obrigatório."}), 400
    if Category.query.filter_by(name=name).first():
        return jsonify({"error": "Já existe uma categoria com esse nome."}), 400

    category = Category(
        name=name,
        bg_color=data.get("bg_color") or "#ffd6e5",
        bar_color=data.get("bar_color") or "#ff8fb1",
        badge_bg=data.get("badge_bg") or "#ffd6e5",
        badge_text=data.get("badge_text") or "#ff5c8a",
    )
    db.session.add(category)
    db.session.commit()
    return jsonify(category.to_dict()), 201


@app.route("/api/categories/<int:category_id>", methods=["PUT"])
def update_category(category_id):
    category = Category.query.get_or_404(category_id)
    data = request.get_json(force=True)

    if "name" in data:
        new_name = data["name"].strip()
        if not new_name:
            return jsonify({"error": "O nome é obrigatório."}), 400
        clash = Category.query.filter(Category.name == new_name, Category.id != category_id).first()
        if clash:
            return jsonify({"error": "Já existe uma categoria com esse nome."}), 400
        category.name = new_name
    if "bg_color" in data:
        category.bg_color = data["bg_color"]
    if "bar_color" in data:
        category.bar_color = data["bar_color"]
    if "badge_bg" in data:
        category.badge_bg = data["badge_bg"]
    if "badge_text" in data:
        category.badge_text = data["badge_text"]

    db.session.commit()
    return jsonify(category.to_dict())


@app.route("/api/categories/<int:category_id>", methods=["DELETE"])
def delete_category(category_id):
    category = Category.query.get_or_404(category_id)
    Task.query.filter_by(category_id=category_id).update({"category_id": None})
    db.session.delete(category)
    db.session.commit()
    return jsonify({"deleted": category_id})


# --- Routes: tasks -------------------------------------------------------

@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    tasks = Task.query.order_by(Task.week_start.is_(None), Task.week_start.asc(), Task.priority.desc()).all()
    return jsonify([t.to_dict() for t in tasks])


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(force=True)
    if not data.get("title"):
        return jsonify({"error": "O título é obrigatório."}), 400

    raw_week = parse_date(data.get("week_start"))
    category_id = data.get("category_id") or None

    task = Task(
        title=data["title"].strip(),
        notes=data.get("notes", "").strip(),
        category_id=category_id,
        week_start=week_monday(raw_week) if raw_week else None,
        priority=data.get("priority") if data.get("priority") in PRIORITIES else "medium",
        status=data.get("status") if data.get("status") in STATUSES else "todo",
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    task = Task.query.get_or_404(task_id)
    data = request.get_json(force=True)

    if "title" in data:
        task.title = data["title"].strip()
    if "notes" in data:
        task.notes = data["notes"].strip()
    if "category_id" in data:
        task.category_id = data["category_id"] or None
    if "week_start" in data:
        raw_week = parse_date(data["week_start"])
        task.week_start = week_monday(raw_week) if raw_week else None
    if "priority" in data and data["priority"] in PRIORITIES:
        task.priority = data["priority"]
    if "status" in data and data["status"] in STATUSES:
        task.status = data["status"]

    db.session.commit()
    return jsonify(task.to_dict())


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    task = Task.query.get_or_404(task_id)
    db.session.delete(task)
    db.session.commit()
    return jsonify({"deleted": task_id})


# --- Routes: milestones ---------------------------------------------------

@app.route("/api/milestones", methods=["GET"])
def list_milestones():
    milestones = Milestone.query.order_by(Milestone.date.asc()).all()
    return jsonify([m.to_dict() for m in milestones])


@app.route("/api/milestones", methods=["POST"])
def create_milestone():
    data = request.get_json(force=True)
    if not data.get("title") or not data.get("date"):
        return jsonify({"error": "Título e data são obrigatórios."}), 400
    milestone = Milestone(title=data["title"].strip(), date=parse_date(data["date"]))
    db.session.add(milestone)
    db.session.commit()
    return jsonify(milestone.to_dict()), 201


@app.route("/api/milestones/<int:milestone_id>", methods=["DELETE"])
def delete_milestone(milestone_id):
    milestone = Milestone.query.get_or_404(milestone_id)
    db.session.delete(milestone)
    db.session.commit()
    return jsonify({"deleted": milestone_id})


# --- Routes: stats ---------------------------------------------------------

@app.route("/api/stats", methods=["GET"])
def stats():
    tasks = Task.query.all()
    total = len(tasks)
    done = len([t for t in tasks if t.status == "done"])
    today = date.today()
    overdue = len([
        t for t in tasks
        if t.week_start and (t.week_start + timedelta(days=6)) < today and t.status != "done"
    ])

    return jsonify({
        "total": total,
        "done": done,
        "overdue": overdue,
        "percent": round((done / total) * 100) if total else 0,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
