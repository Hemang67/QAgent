from flask import Blueprint, render_template_string

# A blueprint with a URL prefix: the adapter must report /settings/profile
settings = Blueprint("settings", __name__, url_prefix="/settings")


@settings.route("/profile")
def profile():
    return render_template_string('<h1>Profile</h1><form><label>Name <input name="name"></label></form>')
