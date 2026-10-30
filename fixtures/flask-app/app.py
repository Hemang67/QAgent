"""Flask fixture for QAgent. Login: demo / demo. Runs on http://127.0.0.1:5181."""
import os
import sys

# Flask is installed into .deps by the test script (pip install --target .deps)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".deps"))

from flask import Flask, abort, redirect, render_template_string, request, session  # noqa: E402

from settings_pages import settings  # noqa: E402

app = Flask(__name__)
app.secret_key = "fixture-only"
app.register_blueprint(settings)

ORDERS = [{"id": 1, "customer": "Acme"}, {"id": 2, "customer": "Globex"}]
PAGE = """<!doctype html><html><head><title>{{ title }}</title></head><body>
<nav><a href="/dashboard">Dashboard</a> <a href="/settings/profile">Profile</a> <a href="/logout">Log out</a></nav>
<main><h1>{{ title }}</h1>{{ body|safe }}</main></body></html>"""


def page(title, body=""):
    return render_template_string(PAGE, title=title, body=body)


@app.before_request
def need_login():
    if request.path in ("/login", "/about") or request.path.startswith("/static"):
        return None
    if not session.get("user"):
        return redirect("/login")
    return None


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if request.form.get("username") == "demo" and request.form.get("password") == "demo":
            session["user"] = "demo"
            return redirect("/dashboard")
        return page("Sign in", "<p>Wrong username or password</p>"), 401
    return page("Sign in", '<form method="post"><input name="username"><input name="password" type="password"><button>Sign in</button></form>')


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/")
def home():
    return redirect("/dashboard")


@app.route("/dashboard")
def dashboard():
    rows = "".join(f"<tr><td>{o['id']}</td><td>{o['customer']}</td></tr>" for o in ORDERS)
    return page("Dashboard", f"<table><thead><tr><th>ID</th><th>Customer</th></tr></thead><tbody>{rows}</tbody></table>")


@app.route("/orders/<int:order_id>")
def order(order_id):
    o = next((x for x in ORDERS if x["id"] == order_id), None)
    if not o:
        abort(404)
    return page(f"Order {o['id']}", f"<p>{o['customer']}</p>")


@app.route("/orders", methods=["POST"])
def create_order():
    return redirect("/dashboard")


@app.route("/reports")
def reports():
    raise RuntimeError("report service unavailable")


@app.route("/about")
def about():
    return page("About", "<p>A fixture app for QAgent.</p>")


@app.route("/admin")
def admin():
    # No permission: back to the dashboard
    return redirect("/dashboard")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5181)
