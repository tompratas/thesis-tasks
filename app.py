import os
from datetime import datetime, date

from flask import Flask, jsonify, request, send_from_directory
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__, static_folder="static", template_folder="templates")

# --- Database config -------------------------------------------------
# Works out of the box with SQLite. If a DATABASE_URL env var is set
# (e.g. a Render PostgreSQL instance), it will be used instead so data
# survives redeploys on Render's free web-service tier.
db_url = os.environ.get("DATABASE_URL", "sqlite:///" + os.path.join(app.instance_path, "tasks.db"))
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

os.makedirs(app.instance_path, exist_ok=True)
app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

STATUSES = ["todo", "doing", "done"]
PRIORITIES = ["low", "medium", "high"]


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    notes = db.Column(db.Text, default="")
    category = db.Column(db.String(120), default="Geral")
    due_date = db.Column(db.Date, nullable=True)
    priority = db.Column(db.String(10), default="medium")
    status = db.Column(db.String(10), default="todo")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "notes": self.notes or "",
            "category": self.category or "Geral",
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "priority": self.priority,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


with app.app_context():
    db.create_all()


def parse_date(value):
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


# --- Routes ------------------------------------------------------------

@app.route("/")
def index():
    return app.send_static_file("index.html") if False else send_from_directory(app.template_folder, "index.html")


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    tasks = Task.query.order_by(Task.due_date.is_(None), Task.due_date.asc(), Task.priority.desc()).all()
    return jsonify([t.to_dict() for t in tasks])


@app.route("/api/tasks", methods=["POST"])
def create_task():
    data = request.get_json(force=True)
    if not data.get("title"):
        return jsonify({"error": "O título é obrigatório."}), 400

    task = Task(
        title=data["title"].strip(),
        notes=data.get("notes", "").strip(),
        category=(data.get("category") or "Geral").strip(),
        due_date=parse_date(data.get("due_date")),
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
    if "category" in data:
        task.category = (data["category"] or "Geral").strip()
    if "due_date" in data:
        task.due_date = parse_date(data["due_date"])
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


@app.route("/api/stats", methods=["GET"])
def stats():
    tasks = Task.query.all()
    total = len(tasks)
    done = len([t for t in tasks if t.status == "done"])
    today = date.today()
    overdue = len([t for t in tasks if t.due_date and t.due_date < today and t.status != "done"])

    by_category = {}
    for t in tasks:
        cat = t.category or "Geral"
        by_category.setdefault(cat, {"total": 0, "done": 0})
        by_category[cat]["total"] += 1
        if t.status == "done":
            by_category[cat]["done"] += 1

    return jsonify({
        "total": total,
        "done": done,
        "overdue": overdue,
        "percent": round((done / total) * 100) if total else 0,
        "by_category": by_category,
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
