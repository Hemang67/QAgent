from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import HTMLResponse
app = FastAPI()
router = APIRouter(prefix="/admin")

@app.get("/", response_class=HTMLResponse)
def home():
    return "<h1>Home</h1>"

@app.get("/api/items")
def items():
    return [1, 2]

@app.get("/orders/{order_id}")
def order(request: Request, order_id: int):
    return templates.TemplateResponse("order.html", {"request": request})

@router.get("/users", response_class=HTMLResponse)
def users():
    return "<h1>Users</h1>"

@app.post("/orders")
def create():
    return {}
