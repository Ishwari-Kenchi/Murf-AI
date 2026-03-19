from fastapi import FastAPI
from fastapi.responses import JSONResponse
from mangum import Mangum

app = FastAPI()

@app.get("/")
def root():
    return {"message": "API is working"}

handler = Mangum(app)
